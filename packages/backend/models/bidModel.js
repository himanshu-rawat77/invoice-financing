const mongoose = require('mongoose');

const bidSchema = new mongoose.Schema(
  {
    bill: {
      type: mongoose.Schema.ObjectId,
      ref: 'Bill',
      required: [true, 'Bill reference is required'],
    },
    financer: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      required: [true, 'Financer reference is required'],
    },
    financingPercentage: {
      type: Number,
      required: [true, 'Financing percentage is required'],
      min: [1, 'Financing percentage must be at least 1%'],
      max: [95, 'Financing percentage cannot exceed 95%'],
    },
    bidAmount: {
      type: Number,
      required: [true, 'Bid amount is required'],
      min: [0, 'Bid amount must be positive'],
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected', 'expired'],
      default: 'pending',
    },
    expiresAt: {
      type: Date,
      default: function () {
        return new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
      },
    },
    acceptedAt: Date,
    paidAt: Date,

    // Additional bid details
    interest: {
      type: Number,
      default: 0,
      min: [0, 'Interest cannot be negative'],
    },
    terms: {
      type: String,
      maxlength: [500, 'Terms cannot exceed 500 characters'],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Compound index to prevent duplicate bids from same financer on same bill
bidSchema.index({ bill: 1, financer: 1 }, { unique: true });
bidSchema.index({ bill: 1, financingPercentage: -1 }); // For finding highest bids
bidSchema.index({ financer: 1, status: 1 });

// Virtual for net amount financer will receive
bidSchema.virtual('netAmount').get(function () {
  return this.bidAmount * (1 - this.interest / 100);
});

// Pre-save middleware to calculate bid amount
bidSchema.pre('save', async function (next) {
  if (this.isNew || this.isModified('financingPercentage')) {
    const Bill = mongoose.model('Bill');
    const bill = await Bill.findById(this.bill);
    if (bill) {
      this.bidAmount = (bill.amount * this.financingPercentage) / 100;
    }
  }
  next();
});

// Pre-save middleware to handle status changes
bidSchema.pre('save', function (next) {
  if (this.isModified('status')) {
    if (this.status === 'accepted' && !this.acceptedAt) {
      this.acceptedAt = new Date();
    }
  }
  next();
});

// Static method to find highest bid for a bill
bidSchema.statics.findHighestBid = function (billId) {
  return this.findOne({
    bill: billId,
    status: 'pending',
    expiresAt: { $gt: new Date() },
  }).sort({ financingPercentage: -1 });
};

// Static method to get active bids for a bill
bidSchema.statics.getActiveBids = function (billId) {
  return this.find({
    bill: billId,
    status: 'pending',
    expiresAt: { $gt: new Date() },
  }).sort({ financingPercentage: -1 });
};

module.exports = mongoose.model('Bid', bidSchema);
