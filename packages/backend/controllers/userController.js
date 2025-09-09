const User = require('../models/userModal');
const Bill = require('../models/billModel');
const Bid = require('../models/bidModel');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const factory = require('./handlerFactory');

const filterObj = (obj, ...allowedFields) => {
  const newObj = {};
  Object.keys(obj).forEach((el) => {
    if (allowedFields.includes(el)) newObj[el] = obj[el];
  });
  return newObj;
};

exports.getMe = (req, res, next) => {
  req.params.id = req.user.id;
  next();
};

exports.getAllUsers = factory.getAll(User);

exports.updateMe = catchAsync(async (req, res, next) => {
  //1)Create error if user POSTs password data
  if (req.body.password || req.body.passwordConfirm) {
    return next(
      new AppError(
        'This route is not for password updates .Please use /updateMyPassword',
        400,
      ),
    );
  }

  //as in req.body there can we many fields which user want to update but we only want to allow the user to only update name and email so we use filterObj() function to filter out the all the unnecessary details and only provide email and name
  const filteredBody = filterObj(req.body, 'name', 'email');
  const updatedUser = await User.findByIdAndUpdate(req.user.id, filteredBody, {
    new: true,
    runValidators: true,
  });

  res.status(200).json({
    status: 'success',
    data: {
      user: updatedUser,
    },
  });
});

//from this function user can delete itself means deleting account from our webapp
exports.deleteMe = catchAsync(async (req, res, next) => {
  await User.findByIdAndUpdate(req.user.id, { active: false });
  res.status(204).json({
    status: 'success',
    data: null,
  });
});
exports.getUser = factory.getOne(User);

exports.createUser = (req, res) => {
  res.status(500).json({
    status: 'error',
    message: 'This route is not yet defined! Please use the /signup instead',
  });
};

exports.updateUser = factory.updateOne(User);

exports.deleteUser = factory.deleteOne(User);

exports.updateProfile = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { role } = req.user;

  // Filter allowed fields based on role
  let allowedFields = ['name', 'photo'];
  let roleSpecificData = {};

  switch (role) {
    case 'organization':
      if (req.body.organizationDetails) {
        roleSpecificData.organizationDetails = req.body.organizationDetails;
      }
      break;
    case 'customer':
      if (req.body.customerDetails) {
        roleSpecificData.customerDetails = req.body.customerDetails;
      }
      break;
    case 'financer':
      if (req.body.financerDetails) {
        // Prevent updating availableFunds directly
        const { availableFunds, ...otherFinancerDetails } =
          req.body.financerDetails;
        roleSpecificData.financerDetails = otherFinancerDetails;
      }
      break;
  }

  const updateData = {};
  allowedFields.forEach((field) => {
    if (req.body[field]) {
      updateData[field] = req.body[field];
    }
  });

  // Merge role-specific data
  Object.assign(updateData, roleSpecificData);

  const updatedUser = await User.findByIdAndUpdate(userId, updateData, {
    new: true,
    runValidators: true,
  });

  res.status(200).json({
    status: 'success',
    data: {
      user: updatedUser,
    },
  });
});

// Get user dashboard data based on role
exports.getDashboard = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { role } = req.user;

  let dashboardData = {
    user: req.user,
    stats: req.user.stats || {},
  };

  switch (role) {
    case 'organization':
      // Get recent bills and their statuses
      const orgBills = await Bill.find({ organization: userId })
        .sort('-createdAt')
        .limit(10)
        .populate('customer financer', 'name email');

      const orgBillStats = await Bill.aggregate([
        { $match: { organization: req.user._id } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalAmount: { $sum: '$amount' },
          },
        },
      ]);

      // Get pending bids on organization's bills
      const pendingBids = await Bid.find({
        bill: {
          $in: await Bill.find({ organization: userId }).distinct('_id'),
        },
        status: 'pending',
      })
        .populate('financer', 'name email')
        .populate('bill', 'billNumber title amount')
        .sort('-financingPercentage');

      dashboardData = {
        ...dashboardData,
        recentBills: orgBills,
        billStats: orgBillStats,
        pendingBids: pendingBids.slice(0, 5), // Top 5 bids
      };
      break;

    case 'customer':
      // Get recent bills received
      const customerBills = await Bill.find({ customer: userId })
        .sort('-createdAt')
        .limit(10)
        .populate(
          'organization financer',
          'name email organizationDetails.companyName',
        );

      const customerBillStats = await Bill.aggregate([
        { $match: { customer: req.user._id } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalAmount: { $sum: '$amount' },
          },
        },
      ]);

      // Get upcoming due bills
      const upcomingBills = await Bill.find({
        customer: userId,
        status: { $in: ['sent', 'financed'] },
        dueDate: {
          $gte: new Date(),
          $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      }).sort('dueDate');

      dashboardData = {
        ...dashboardData,
        recentBills: customerBills,
        billStats: customerBillStats,
        upcomingBills,
      };
      break;

    case 'financer':
      // Get recent bids
      const recentBids = await Bid.find({ financer: userId })
        .sort('-createdAt')
        .limit(10)
        .populate('bill', 'billNumber title amount dueDate organization')
        .populate('bill.organization', 'name organizationDetails.companyName');

      const bidStats = await Bid.aggregate([
        { $match: { financer: req.user._id } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalAmount: { $sum: '$bidAmount' },
          },
        },
      ]);

      // Get active investments (accepted bids)
      const activeInvestments = await Bill.find({
        financer: userId,
        status: 'financed',
      })
        .populate('organization customer', 'name email')
        .sort('-financedAt');

      // Get marketplace opportunities (sample)
      const marketplaceOpportunities = await Bill.find({
        isInMarketplace: true,
        status: 'sent',
        financer: { $exists: false },
        dueDate: { $gt: new Date() },
      })
        .limit(5)
        .populate('organization', 'name organizationDetails.companyName')
        .sort('-amount');

      dashboardData = {
        ...dashboardData,
        recentBids,
        bidStats,
        activeInvestments,
        marketplaceOpportunities,
        availableFunds: req.user.financerDetails?.availableFunds || 0,
      };
      break;
  }

  res.status(200).json({
    status: 'success',
    data: dashboardData,
  });
});

// Get user statistics
exports.getUserStats = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { role } = req.user;

  let stats = {};

  switch (role) {
    case 'organization':
      stats = await Bill.aggregate([
        { $match: { organization: req.user._id } },
        {
          $group: {
            _id: null,
            totalBills: { $sum: 1 },
            totalRevenue: { $sum: '$amount' },
            avgBillAmount: { $avg: '$amount' },
            billsSent: {
              $sum: { $cond: [{ $ne: ['$status', 'draft'] }, 1, 0] },
            },
            billsPaid: {
              $sum: { $cond: [{ $eq: ['$status', 'paid'] }, 1, 0] },
            },
            billsFinanced: {
              $sum: { $cond: [{ $eq: ['$status', 'financed'] }, 1, 0] },
            },
          },
        },
      ]);
      break;

    case 'customer':
      stats = await Bill.aggregate([
        { $match: { customer: req.user._id } },
        {
          $group: {
            _id: null,
            totalBills: { $sum: 1 },
            totalAmount: { $sum: '$amount' },
            avgBillAmount: { $avg: '$amount' },
            billsPaid: {
              $sum: { $cond: [{ $eq: ['$status', 'paid'] }, 1, 0] },
            },
            billsOverdue: {
              $sum: { $cond: [{ $eq: ['$status', 'overdue'] }, 1, 0] },
            },
            totalPaid: {
              $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$amount', 0] },
            },
          },
        },
      ]);
      break;

    case 'financer':
      const [bidStats, investmentStats] = await Promise.all([
        Bid.aggregate([
          { $match: { financer: req.user._id } },
          {
            $group: {
              _id: null,
              totalBids: { $sum: 1 },
              totalBidAmount: { $sum: '$bidAmount' },
              avgBidAmount: { $avg: '$bidAmount' },
              bidsWon: {
                $sum: { $cond: [{ $eq: ['$status', 'accepted'] }, 1, 0] },
              },
              successRate: {
                $avg: { $cond: [{ $eq: ['$status', 'accepted'] }, 1, 0] },
              },
            },
          },
        ]),
        Bill.aggregate([
          { $match: { financer: req.user._id } },
          {
            $group: {
              _id: null,
              totalInvestments: { $sum: 1 },
              totalInvested: { $sum: '$financedAmount' },
              avgInvestment: { $avg: '$financedAmount' },
              activeInvestments: {
                $sum: { $cond: [{ $eq: ['$status', 'financed'] }, 1, 0] },
              },
              completedInvestments: {
                $sum: { $cond: [{ $eq: ['$status', 'paid'] }, 1, 0] },
              },
            },
          },
        ]),
      ]);

      stats = {
        bidStats: bidStats[0] || {},
        investmentStats: investmentStats[0] || {},
        availableFunds: req.user.financerDetails?.availableFunds || 0,
      };
      break;
  }

  res.status(200).json({
    status: 'success',
    data: {
      stats: stats[0] || stats,
      userStats: req.user.stats,
    },
  });
});

// Add funds to financer account
exports.addFunds = catchAsync(async (req, res, next) => {
  if (req.user.role !== 'financer') {
    return next(new AppError('Only financers can add funds', 403));
  }

  const { amount } = req.body;

  if (!amount || amount <= 0) {
    return next(new AppError('Amount must be positive', 400));
  }

  // In a real application, this would involve payment processing
  req.user.financerDetails.availableFunds += amount;
  await req.user.save({ validateBeforeSave: false });

  res.status(200).json({
    status: 'success',
    data: {
      availableFunds: req.user.financerDetails.availableFunds,
    },
  });
});

// Get all customers (for organizations to select when creating bills)
exports.getCustomers = catchAsync(async (req, res, next) => {
  if (req.user.role !== 'organization') {
    return next(
      new AppError('Only organizations can access customer list', 403),
    );
  }

  const customers = await User.find({
    role: 'customer',
    active: { $ne: false },
  }).select('name email customerDetails');

  res.status(200).json({
    status: 'success',
    results: customers.length,
    data: {
      customers,
    },
  });
});

// Upload verification documents
exports.uploadVerificationDocument = catchAsync(async (req, res, next) => {
  const { documentType, documentUrl } = req.body;

  if (!documentType || !documentUrl) {
    return next(new AppError('Document type and URL are required', 400));
  }

  const validTypes = [
    'identity',
    'business_license',
    'tax_document',
    'bank_statement',
    'other',
  ];
  if (!validTypes.includes(documentType)) {
    return next(new AppError('Invalid document type', 400));
  }

  req.user.verificationDocuments.push({
    documentType,
    documentUrl,
  });

  await req.user.save({ validateBeforeSave: false });

  res.status(200).json({
    status: 'success',
    data: {
      verificationDocuments: req.user.verificationDocuments,
    },
  });
});

// Get user activity feed
exports.getActivityFeed = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { role } = req.user;
  const limit = parseInt(req.query.limit) || 10;

  let activities = [];

  switch (role) {
    case 'organization':
      // Get recent bill activities
      const orgBills = await Bill.find({ organization: userId })
        .sort('-updatedAt')
        .limit(limit)
        .select('billNumber title status updatedAt customer')
        .populate('customer', 'name');

      activities = orgBills.map((bill) => ({
        type: 'bill',
        action: `Bill ${bill.billNumber} status: ${bill.status}`,
        date: bill.updatedAt,
        details: {
          billNumber: bill.billNumber,
          title: bill.title,
          customer: bill.customer?.name,
        },
      }));
      break;

    case 'customer':
      // Get recent bill activities
      const customerBills = await Bill.find({ customer: userId })
        .sort('-updatedAt')
        .limit(limit)
        .select('billNumber title status updatedAt organization')
        .populate('organization', 'name organizationDetails.companyName');

      activities = customerBills.map((bill) => ({
        type: 'bill',
        action: `Bill ${bill.billNumber} from ${bill.organization?.organizationDetails?.companyName || bill.organization?.name}`,
        date: bill.updatedAt,
        details: {
          billNumber: bill.billNumber,
          title: bill.title,
          status: bill.status,
          organization:
            bill.organization?.organizationDetails?.companyName ||
            bill.organization?.name,
        },
      }));
      break;

    case 'financer':
      // Get recent bid activities
      const recentBids = await Bid.find({ financer: userId })
        .sort('-updatedAt')
        .limit(limit)
        .populate('bill', 'billNumber title organization')
        .populate('bill.organization', 'name organizationDetails.companyName');

      activities = recentBids.map((bid) => ({
        type: 'bid',
        action: `Bid ${bid.status} for ${bid.bill.billNumber}`,
        date: bid.updatedAt,
        details: {
          billNumber: bid.bill.billNumber,
          billTitle: bid.bill.title,
          status: bid.status,
          percentage: bid.financingPercentage,
          organization:
            bid.bill.organization?.organizationDetails?.companyName ||
            bid.bill.organization?.name,
        },
      }));
      break;
  }

  res.status(200).json({
    status: 'success',
    results: activities.length,
    data: {
      activities,
    },
  });
});
