const Bill = require('../models/billModel');
const User = require('../models/userModal');
const Bid = require('../models/bidModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const APIFeatures = require('../utils/apiFeatures');

// Generate unique bill number
const generateBillNumber = () => {
  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 8);
  return `BILL-${timestamp}-${randomStr}`.toUpperCase();
};

// Create a new bill (Organization only)
exports.createBill = catchAsync(async (req, res, next) => {
  // Check if user is organization
  if (req.user.role !== 'organization') {
    return next(new AppError('Only organizations can create bills', 403));
  }

  // Verify customer exists and has customer role
  const customer = await User.findById(req.body.customer);
  if (!customer || customer.role !== 'customer') {
    return next(new AppError('Invalid customer ID', 400));
  }

  const billData = {
    ...req.body,
    organization: req.user.id,
    currentOwner: req.user.id,
    billNumber: generateBillNumber(),
  };

  const bill = await Bill.create(billData);
  await req.user.updateStats('billCreated');

  res.status(201).json({
    status: 'success',
    data: {
      bill,
    },
  });
});

// Send bill to customer (Organization only)
exports.sendBill = catchAsync(async (req, res, next) => {
  const bill = await Bill.findById(req.params.id);

  if (!bill) {
    return next(new AppError('No bill found with that ID', 404));
  }

  // Check if user owns the bill
  if (bill.organization.toString() !== req.user.id) {
    return next(new AppError('You can only send your own bills', 403));
  }

  if (bill.status !== 'draft') {
    return next(new AppError('Bill has already been sent', 400));
  }

  bill.status = 'sent';
  await bill.save();

  await req.user.updateStats('billSent');

  // Update customer stats
  const customer = await User.findById(bill.customer);
  await customer.updateStats('billReceived');

  res.status(200).json({
    status: 'success',
    data: {
      bill,
    },
  });
});

// Get all bills for current user based on role
exports.getMyBills = catchAsync(async (req, res, next) => {
  let filter = {};

  switch (req.user.role) {
    case 'organization':
      filter = { organization: req.user.id };
      break;
    case 'customer':
      filter = { customer: req.user.id };
      break;
    case 'financer':
      filter = { financer: req.user.id };
      break;
  }

  const features = new APIFeatures(Bill.find(filter), req.query)
    .filter()
    .sort()
    .limitFields()
    .paginate();

  const bills = await features.query.populate(
    'organization customer financer',
    'name email',
  );

  res.status(200).json({
    status: 'success',
    results: bills.length,
    data: {
      bills,
    },
  });
});

// Get bills by status for current user
exports.getBillsByStatus = catchAsync(async (req, res, next) => {
  const { status } = req.params;
  let filter = { status };

  switch (req.user.role) {
    case 'organization':
      filter.organization = req.user.id;
      break;
    case 'customer':
      filter.customer = req.user.id;
      break;
    case 'financer':
      filter.financer = req.user.id;
      break;
  }

  const bills = await Bill.find(filter)
    .populate('organization customer financer', 'name email')
    .sort('-createdAt');

  res.status(200).json({
    status: 'success',
    results: bills.length,
    data: {
      bills,
    },
  });
});

// Get marketplace bills (available for financing)
exports.getMarketplaceBills = catchAsync(async (req, res, next) => {
  // Only financers can access marketplace
  if (req.user.role !== 'financer') {
    return next(new AppError('Only financers can access the marketplace', 403));
  }

  const filter = {
    isInMarketplace: true,
    status: 'sent',
    dueDate: { $gt: new Date() }, // Not overdue
    financer: { $exists: false }, // Not yet financed
  };

  const features = new APIFeatures(Bill.find(filter), req.query)
    .filter()
    .sort()
    .limitFields()
    .paginate();

  const bills = await features.query
    .populate(
      'organization customer',
      'name email organizationDetails.companyName',
    )
    .populate({
      path: 'bids',
      match: { status: 'pending' },
      select: 'financer financingPercentage bidAmount',
      populate: {
        path: 'financer',
        select: 'name email',
      },
    });

  res.status(200).json({
    status: 'success',
    results: bills.length,
    data: {
      bills,
    },
  });
});

// Pay bill (Customer only)
exports.payBill = catchAsync(async (req, res, next) => {
  const bill = await Bill.findById(req.params.id);

  if (!bill) {
    return next(new AppError('No bill found with that ID', 404));
  }

  // Check if user is the customer for this bill
  if (bill.customer.toString() !== req.user.id) {
    return next(new AppError('You can only pay your own bills', 403));
  }

  if (bill.status === 'paid') {
    return next(new AppError('Bill has already been paid', 400));
  }

  if (
    bill.status !== 'sent' &&
    bill.status !== 'overdue' &&
    bill.status !== 'financed'
  ) {
    return next(new AppError('Bill cannot be paid in current status', 400));
  }

  // Update bill status
  bill.status = 'paid';
  await bill.save();

  // Update customer stats
  await req.user.updateStats('billPaid');
  await req.user.updateStats('amountPaid', bill.amount);

  // Update owner stats (could be organization or financer)
  const owner = await User.findById(bill.currentOwner);
  if (owner.role === 'organization') {
    await owner.updateStats('revenueEarned', bill.amount);
  } else if (owner.role === 'financer') {
    const returnAmount = bill.amount - bill.financedAmount;
    await owner.updateStats('returnsEarned', returnAmount);
  }

  res.status(200).json({
    status: 'success',
    data: {
      bill,
    },
  });
});

// Get single bill details
exports.getBill = catchAsync(async (req, res, next) => {
  const bill = await Bill.findById(req.params.id).populate(
    'organization customer financer',
    'name email organizationDetails.companyName',
  );

  if (!bill) {
    return next(new AppError('No bill found with that ID', 404));
  }

  // Check access permissions
  const hasAccess =
    bill.organization.toString() === req.user.id ||
    bill.customer.toString() === req.user.id ||
    (bill.financer && bill.financer.toString() === req.user.id);

  if (!hasAccess) {
    return next(
      new AppError('You do not have permission to access this bill', 403),
    );
  }

  // Get bids if user has access and bill is in marketplace
  let bids = [];
  if (
    bill.isInMarketplace &&
    (bill.organization.toString() === req.user.id ||
      req.user.role === 'financer')
  ) {
    bids = await Bid.find({ bill: bill._id })
      .populate('financer', 'name email')
      .sort('-financingPercentage');
  }

  res.status(200).json({
    status: 'success',
    data: {
      bill,
      bids,
    },
  });
});

// Update bill (Organization only, draft bills only)
exports.updateBill = catchAsync(async (req, res, next) => {
  const bill = await Bill.findById(req.params.id);

  if (!bill) {
    return next(new AppError('No bill found with that ID', 404));
  }

  if (bill.organization.toString() !== req.user.id) {
    return next(new AppError('You can only update your own bills', 403));
  }

  if (bill.status !== 'draft') {
    return next(new AppError('Only draft bills can be updated', 400));
  }

  // Prevent updating certain fields
  const allowedFields = [
    'title',
    'description',
    'amount',
    'dueDate',
    'customer',
  ];
  const updateData = {};

  Object.keys(req.body).forEach((key) => {
    if (allowedFields.includes(key)) {
      updateData[key] = req.body[key];
    }
  });

  const updatedBill = await Bill.findByIdAndUpdate(req.params.id, updateData, {
    new: true,
    runValidators: true,
  });

  res.status(200).json({
    status: 'success',
    data: {
      bill: updatedBill,
    },
  });
});

// Delete bill (Organization only, draft bills only)
exports.deleteBill = catchAsync(async (req, res, next) => {
  const bill = await Bill.findById(req.params.id);

  if (!bill) {
    return next(new AppError('No bill found with that ID', 404));
  }

  if (bill.organization.toString() !== req.user.id) {
    return next(new AppError('You can only delete your own bills', 403));
  }

  if (bill.status !== 'draft') {
    return next(new AppError('Only draft bills can be deleted', 400));
  }

  await Bill.findByIdAndDelete(req.params.id);

  res.status(204).json({
    status: 'success',
    data: null,
  });
});

// Get bills dashboard stats
exports.getBillsStats = catchAsync(async (req, res, next) => {
  let matchStage = {};

  switch (req.user.role) {
    case 'organization':
      matchStage = { organization: req.user._id };
      break;
    case 'customer':
      matchStage = { customer: req.user._id };
      break;
    case 'financer':
      matchStage = { financer: req.user._id };
      break;
  }

  const stats = await Bill.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalAmount: { $sum: '$amount' },
      },
    },
  ]);

  const totalStats = await Bill.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalBills: { $sum: 1 },
        totalAmount: { $sum: '$amount' },
        avgAmount: { $avg: '$amount' },
      },
    },
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      statusStats: stats,
      totalStats: totalStats[0] || {
        totalBills: 0,
        totalAmount: 0,
        avgAmount: 0,
      },
    },
  });
});
