const mongoose = require('mongoose');

const billSchema = new mongoose.Schema(
  {
    billNumber: {
      type: String,
      required: [true, 'Bill number is required'],
      unique: true,
    },
    title: {
      type: String,
      required: [true, 'Bill title is required'],
    },
    description: {
      type: String,
      required: [true, 'Bill description is required'],
    },
    amount: {
      type: Number,
      required: [true, 'Bill amount is required'],
      min: [0, 'Amount must be positive'],
    },
    dueDate: {
      type: Date,
      required: [true, 'Due date is required'],
      validate: {
        validator: function (date) {
          return date > new Date();
        },
        message: 'Due date must be in the future',
      },
    },
    status: {
      type: String,
      enum: ['draft', 'sent', 'paid', 'overdue', 'financed'],
      default: 'draft',
    },
    isActive: {
      type: Boolean,
      default: true,
    },

    // References
    organization: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      required: [true, 'Organization is required'],
    },
    customer: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      required: [true, 'Customer is required'],
    },
    currentOwner: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      required: true,
    },

    // Financing related fields
    isInMarketplace: {
      type: Boolean,
      default: false,
    },
    financingPercentage: {
      type: Number,
      min: [0, 'Financing percentage cannot be negative'],
      max: [100, 'Financing percentage cannot exceed 100'],
    },
    financedAmount: {
      type: Number,
      default: 0,
    },
    financer: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      default: null,
    },

    // Timestamps
    sentAt: Date,
    paidAt: Date,
    financedAt: Date,
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Indexes for better performance
billSchema.index({ organization: 1, status: 1 });
billSchema.index({ customer: 1, status: 1 });
billSchema.index({ financer: 1 });
billSchema.index({ isInMarketplace: 1, status: 1 });

// Virtual for remaining amount after financing
billSchema.virtual('remainingAmount').get(function () {
  return this.amount - this.financedAmount;
});

// Virtual for days until due
billSchema.virtual('daysUntilDue').get(function () {
  const today = new Date();
  const timeDiff = this.dueDate.getTime() - today.getTime();
  return Math.ceil(timeDiff / (1000 * 3600 * 24));
});

// Pre-save middleware to set currentOwner
billSchema.pre('save', function (next) {
  if (this.isNew) {
    this.currentOwner = this.organization;
  }
  next();
});

// Pre-save middleware to handle status changes
billSchema.pre('save', function (next) {
  if (this.status === 'sent' && this.dueDate < new Date()) {
    this.status = 'overdue';
  }

  if (this.isModified('status')) {
    if (this.status === 'sent' && !this.sentAt) {
      this.sentAt = new Date();
      this.isInMarketplace = true;
    }
    if (this.status === 'paid' && !this.paidAt) {
      this.paidAt = new Date();
      this.isActive = false;
      this.isInMarketplace = false;
    }
    if (this.status === 'financed' && !this.financedAt) {
      this.financedAt = new Date();
    }
  }

  next();
});

module.exports = mongoose.model('Bill', billSchema);
