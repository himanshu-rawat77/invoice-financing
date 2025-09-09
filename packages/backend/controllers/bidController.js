const Bid = require('../models/bidModel');
const Bill = require('../models/billModel');
const User = require('../models/userModal');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const APIFeatures = require('../utils/apiFeatures');

// Place a bid on a bill (Financer only)
exports.placeBid = catchAsync(async (req, res, next) => {
  // Check if user is financer
  if (req.user.role !== 'financer') {
    return next(new AppError('Only financers can place bids', 403));
  }

  const { billId, financingPercentage, terms, interest } = req.body;

  // Validate bill exists and is available for financing
  const bill = await Bill.findById(billId);
  if (!bill) {
    return next(new AppError('No bill found with that ID', 404));
  }

  if (!bill.isInMarketplace || bill.status !== 'sent') {
    return next(new AppError('Bill is not available for financing', 400));
  }

  if (bill.financer) {
    return next(new AppError('Bill has already been financed', 400));
  }

  if (bill.dueDate <= new Date()) {
    return next(new AppError('Cannot bid on overdue bills', 400));
  }

  // Check if financer has sufficient funds
  const bidAmount = (bill.amount * financingPercentage) / 100;
  if (req.user.financerDetails.availableFunds < bidAmount) {
    return next(new AppError('Insufficient funds to place this bid', 400));
  }

  // Check if financer already has a bid on this bill
  const existingBid = await Bid.findOne({
    bill: billId,
    financer: req.user.id,
  });
  if (existingBid) {
    return next(
      new AppError('You have already placed a bid on this bill', 400),
    );
  }

  const bid = await Bid.create({
    bill: billId,
    financer: req.user.id,
    financingPercentage,
    terms,
    interest: interest || 0,
  });

  await req.user.updateStats('bidPlaced');

  res.status(201).json({
    status: 'success',
    data: {
      bid,
    },
  });
});

// Update existing bid (Financer only)
exports.updateBid = catchAsync(async (req, res, next) => {
  const bid = await Bid.findById(req.params.id);

  if (!bid) {
    return next(new AppError('No bid found with that ID', 404));
  }

  if (bid.financer.toString() !== req.user.id) {
    return next(new AppError('You can only update your own bids', 403));
  }

  if (bid.status !== 'pending') {
    return next(new AppError('Only pending bids can be updated', 400));
  }

  if (bid.expiresAt <= new Date()) {
    return next(new AppError('Bid has expired', 400));
  }

  // Check if bill is still available
  const bill = await Bill.findById(bid.bill);
  if (bill.financer) {
    return next(new AppError('Bill has already been financed', 400));
  }

  const allowedFields = ['financingPercentage', 'terms', 'interest'];
  const updateData = {};

  Object.keys(req.body).forEach((key) => {
    if (allowedFields.includes(key)) {
      updateData[key] = req.body[key];
    }
  });

  // Recalculate bid amount if percentage changed
  if (updateData.financingPercentage) {
    const newBidAmount = (bill.amount * updateData.financingPercentage) / 100;
    if (req.user.financerDetails.availableFunds < newBidAmount) {
      return next(
        new AppError('Insufficient funds for updated bid amount', 400),
      );
    }
  }

  const updatedBid = await Bid.findByIdAndUpdate(req.params.id, updateData, {
    new: true,
    runValidators: true,
  });

  res.status(200).json({
    status: 'success',
    data: {
      bid: updatedBid,
    },
  });
});

// Accept a bid (Organization only)
exports.acceptBid = catchAsync(async (req, res, next) => {
  const bid = await Bid.findById(req.params.id).populate('bill');

  if (!bid) {
    return next(new AppError('No bid found with that ID', 404));
  }

  const bill = bid.bill;

  // Check if user owns the bill
  if (bill.organization.toString() !== req.user.id) {
    return next(
      new AppError('You can only accept bids on your own bills', 403),
    );
  }

  if (bid.status !== 'pending') {
    return next(new AppError('Bid is no longer available', 400));
  }

  if (bid.expiresAt <= new Date()) {
    return next(new AppError('Bid has expired', 400));
  }

  if (bill.financer) {
    return next(new AppError('Bill has already been financed', 400));
  }

  // Update bid status
  bid.status = 'accepted';
  await bid.save();

  // Update bill with financing details
  bill.financer = bid.financer;
  bill.currentOwner = bid.financer;
  bill.status = 'financed';
  bill.financingPercentage = bid.financingPercentage;
  bill.financedAmount = bid.bidAmount;
  bill.isInMarketplace = false;
  await bill.save();

  // Reject all other pending bids for this bill
  await Bid.updateMany(
    { bill: bill._id, status: 'pending', _id: { $ne: bid._id } },
    { status: 'rejected' },
  );

  // Update financer stats
  const financer = await User.findById(bid.financer);
  await financer.updateStats('bidWon');
  await financer.updateStats('invested', bid.bidAmount);

  // Update financer's available funds
  financer.financerDetails.availableFunds -= bid.bidAmount;
  await financer.save({ validateBeforeSave: false });

  res.status(200).json({
    status: 'success',
    data: {
      bid,
      bill,
    },
  });
});

// Get all bids for current user (Financer only)
exports.getMyBids = catchAsync(async (req, res, next) => {
  if (req.user.role !== 'financer') {
    return next(new AppError('Only financers can access bids', 403));
  }

  const features = new APIFeatures(
    Bid.find({ financer: req.user.id }),
    req.query,
  )
    .filter()
    .sort()
    .limitFields()
    .paginate();

  const bids = await features.query
    .populate('bill', 'billNumber title amount dueDate status')
    .populate('bill.organization', 'name organizationDetails.companyName');

  res.status(200).json({
    status: 'success',
    results: bids.length,
    data: {
      bids,
    },
  });
});

// Get bids for a specific bill (Organization owner or Financer)
exports.getBidsForBill = catchAsync(async (req, res, next) => {
  const bill = await Bill.findById(req.params.billId);

  if (!bill) {
    return next(new AppError('No bill found with that ID', 404));
  }

  // Check permissions
  const canAccess =
    bill.organization.toString() === req.user.id ||
    req.user.role === 'financer';

  if (!canAccess) {
    return next(
      new AppError('You do not have permission to view these bids', 403),
    );
  }

  let filter = { bill: req.params.billId };

  // Financers can only see their own bids unless they're viewing marketplace
  if (
    req.user.role === 'financer' &&
    bill.organization.toString() !== req.user.id
  ) {
    filter.financer = req.user.id;
  }

  const bids = await Bid.find(filter)
    .populate('financer', 'name email financerDetails.companyName')
    .sort('-financingPercentage -createdAt');

  res.status(200).json({
    status: 'success',
    results: bids.length,
    data: {
      bids,
    },
  });
});

// Get single bid details
exports.getBid = catchAsync(async (req, res, next) => {
  const bid = await Bid.findById(req.params.id)
    .populate('bill', 'billNumber title amount dueDate status organization')
    .populate('financer', 'name email financerDetails.companyName');

  if (!bid) {
    return next(new AppError('No bid found with that ID', 404));
  }

  // Check access permissions
  const hasAccess =
    bid.financer.toString() === req.user.id ||
    bid.bill.organization.toString() === req.user.id;

  if (!hasAccess) {
    return next(
      new AppError('You do not have permission to access this bid', 403),
    );
  }

  res.status(200).json({
    status: 'success',
    data: {
      bid,
    },
  });
});

// Cancel/withdraw bid (Financer only)
exports.cancelBid = catchAsync(async (req, res, next) => {
  const bid = await Bid.findById(req.params.id);

  if (!bid) {
    return next(new AppError('No bid found with that ID', 404));
  }

  if (bid.financer.toString() !== req.user.id) {
    return next(new AppError('You can only cancel your own bids', 403));
  }

  if (bid.status !== 'pending') {
    return next(new AppError('Only pending bids can be cancelled', 400));
  }

  await Bid.findByIdAndDelete(req.params.id);

  res.status(204).json({
    status: 'success',
    data: null,
  });
});

// Get highest bid for a bill
exports.getHighestBid = catchAsync(async (req, res, next) => {
  const bill = await Bill.findById(req.params.billId);

  if (!bill) {
    return next(new AppError('No bill found with that ID', 404));
  }

  // Check permissions
  const canAccess =
    bill.organization.toString() === req.user.id ||
    req.user.role === 'financer';

  if (!canAccess) {
    return next(
      new AppError(
        'You do not have permission to view bids for this bill',
        403,
      ),
    );
  }

  const highestBid = await Bid.findHighestBid(req.params.billId);

  res.status(200).json({
    status: 'success',
    data: {
      highestBid,
    },
  });
});

// Get bid statistics for financer
exports.getBidStats = catchAsync(async (req, res, next) => {
  if (req.user.role !== 'financer') {
    return next(new AppError('Only financers can access bid statistics', 403));
  }

  const stats = await Bid.aggregate([
    { $match: { financer: req.user._id } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalAmount: { $sum: '$bidAmount' },
        avgPercentage: { $avg: '$financingPercentage' },
      },
    },
  ]);

  const totalStats = await Bid.aggregate([
    { $match: { financer: req.user._id } },
    {
      $group: {
        _id: null,
        totalBids: { $sum: 1 },
        totalBidAmount: { $sum: '$bidAmount' },
        avgBidAmount: { $avg: '$bidAmount' },
        maxPercentage: { $max: '$financingPercentage' },
        minPercentage: { $min: '$financingPercentage' },
      },
    },
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      statusStats: stats,
      totalStats: totalStats[0] || {
        totalBids: 0,
        totalBidAmount: 0,
        avgBidAmount: 0,
        maxPercentage: 0,
        minPercentage: 0,
      },
    },
  });
});
