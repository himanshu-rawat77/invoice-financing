const crypto = require('crypto');
const mongoose = require('mongoose');
const validator = require('validator');
const bcrypt = require('bcryptjs');
const { type } = require('os');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please tell us your name!'],
    },
    email: {
      type: String,
      required: [true, 'Please provide your email'],
      unique: true,
      lowercase: true,
      validate: [validator.isEmail, 'Please provide a valid email'],
    },
    photo: String,
    role: {
      type: String,
      enum: ['customer', 'organization', 'financer'],
      default: 'customer',
    },
    password: {
      type: String,
      required: [true, 'Please provide a password'],
      minlength: 8,
      select: false,
    },
    passwordConfirm: {
      type: String,
      required: [true, 'Please confirm your password'],
      validate: {
        validator: function (el) {
          return el === this.password;
        },
        message: 'Passwords are not the same',
      },
    },
    passwordChangedAt: Date,
    passwordResetToken: String,
    passwordResetExpires: Date,
    active: {
      type: Boolean,
      default: true,
      select: false,
    },

    // Organization specific fields
    organizationDetails: {
      companyName: String,
      businessType: String,
      registrationNumber: String,
      taxId: String,
      address: {
        street: String,
        city: String,
        state: String,
        zipCode: String,
        country: String,
      },
      bankDetails: {
        accountNumber: String,
        bankName: String,
        routingNumber: String,
      },
    },

    // Customer specific fields
    customerDetails: {
      address: {
        street: String,
        city: String,
        state: String,
        zipCode: String,
        country: String,
      },
      phone: String,
      dateOfBirth: Date,
    },

    // Financer specific fields
    financerDetails: {
      companyName: String,
      licenseNumber: String,
      creditRating: {
        type: String,
        enum: ['AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'CCC', 'CC', 'C', 'D'],
      },
      availableFunds: {
        type: Number,
        default: 0,
        min: [0, 'Available funds cannot be negative'],
      },
      investmentPreferences: {
        minAmount: { type: Number, default: 0 },
        maxAmount: { type: Number, default: 1000000 },
        preferredSectors: [String],
        riskTolerance: {
          type: String,
          enum: ['low', 'medium', 'high'],
          default: 'medium',
        },
      },
    },

    // Statistics and tracking
    stats: {
      // Organization stats
      totalBillsCreated: { type: Number, default: 0 },
      totalBillsSent: { type: Number, default: 0 },
      totalRevenue: { type: Number, default: 0 },

      // Customer stats
      totalBillsReceived: { type: Number, default: 0 },
      totalBillsPaid: { type: Number, default: 0 },
      totalAmountPaid: { type: Number, default: 0 },

      // Financer stats
      totalBidsPlaced: { type: Number, default: 0 },
      totalBidsWon: { type: Number, default: 0 },
      totalInvestmentAmount: { type: Number, default: 0 },
      totalReturns: { type: Number, default: 0 },
    },

    // Verification status
    isVerified: {
      type: Boolean,
      default: false,
    },
    verificationDocuments: [
      {
        documentType: {
          type: String,
          enum: [
            'identity',
            'business_license',
            'tax_document',
            'bank_statement',
            'other',
          ],
        },
        documentUrl: String,
        uploadedAt: { type: Date, default: Date.now },
        verifiedAt: Date,
        status: {
          type: String,
          enum: ['pending', 'approved', 'rejected'],
          default: 'pending',
        },
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Indexes for better performance
userSchema.index({ email: 1 });
userSchema.index({ role: 1 });
userSchema.index({ 'organizationDetails.companyName': 1 });

// Virtual for bills sent (organization)
userSchema.virtual('billsSent', {
  ref: 'Bill',
  localField: '_id',
  foreignField: 'organization',
});

// Virtual for bills received (customer)
userSchema.virtual('billsReceived', {
  ref: 'Bill',
  localField: '_id',
  foreignField: 'customer',
});

// Virtual for bills owned (current owner - could be organization or financer)
userSchema.virtual('billsOwned', {
  ref: 'Bill',
  localField: '_id',
  foreignField: 'currentOwner',
});

// Virtual for bids placed (financer)
userSchema.virtual('bidsPlaced', {
  ref: 'Bid',
  localField: '_id',
  foreignField: 'financer',
});

// Pre-save middleware to ensure role-specific fields
userSchema.pre('save', function (next) {
  // Initialize role-specific details if they don't exist
  if (this.role === 'organization' && !this.organizationDetails) {
    this.organizationDetails = {};
  }
  if (this.role === 'customer' && !this.customerDetails) {
    this.customerDetails = {};
  }
  if (this.role === 'financer' && !this.financerDetails) {
    this.financerDetails = {
      availableFunds: 0,
      investmentPreferences: {
        minAmount: 0,
        maxAmount: 1000000,
        preferredSectors: [],
        riskTolerance: 'medium',
      },
    };
  }

  next();
});

// Method to update stats based on role
userSchema.methods.updateStats = async function (statType, value = 1) {
  if (!this.stats) this.stats = {};

  switch (statType) {
    case 'billCreated':
      this.stats.totalBillsCreated += value;
      break;
    case 'billSent':
      this.stats.totalBillsSent += value;
      break;
    case 'revenueEarned':
      this.stats.totalRevenue += value;
      break;
    case 'billReceived':
      this.stats.totalBillsReceived += value;
      break;
    case 'billPaid':
      this.stats.totalBillsPaid += value;
      break;
    case 'amountPaid':
      this.stats.totalAmountPaid += value;
      break;
    case 'bidPlaced':
      this.stats.totalBidsPlaced += value;
      break;
    case 'bidWon':
      this.stats.totalBidsWon += value;
      break;
    case 'invested':
      this.stats.totalInvestmentAmount += value;
      break;
    case 'returnsEarned':
      this.stats.totalReturns += value;
      break;
  }

  return this.save({ validateBeforeSave: false });
};
//Using mongoose middleware to encrypt the password we save on the mongoDB
//this pre and save middleware will run b/w getting the data and saving it to the database

userSchema.pre('save', async function (next) {
  //Only run this function if password was actually modified
  //here below (this) keyword refers to the current document/user
  if (!this.isModified('password')) return next();

  this.password = await bcrypt.hash(this.password, 12); // here we encrypted the real password

  //now we need to delete the confirm password as we only need to encrypt the real password
  this.passwordConfirm = undefined;
  next();
});

userSchema.pre('save', function (next) {
  if (!this.isModified('password') || this.isNew) return next();

  this.passwordChangedAt = Date.now() - 1000;
  next();
});

//this middleware will do not show the deleted user to output which we implimented in this route(/deleteMe) in userRoutes.js file it will just use the property of user which is deleted have a property active:false
//so here /^find/ this will work for any query which starts with find
userSchema.pre(/^find/, function (next) {
  //this points to the current query
  this.find({ active: { $ne: false } });
  next();
});

//Function which will check if the given password is the same as the one stored in the document
//This function is an instance method so it is available on all the user documents
userSchema.methods.correctPassWord = async function (
  candidatePassword,
  userPassword,
) {
  return await bcrypt.compare(candidatePassword, userPassword);
};

//Function to check if the user had recently changed password after the token was issued

userSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(
      this.passwordChangedAt.getTime() / 1000,
      10,
    );
    return JWTTimestamp < changedTimestamp;
  }

  return false; //by default assuming that user has not changed the password
};

//here we are creating a function which will create a token so that user can change its password
userSchema.methods.createPasswordResetToken = function () {
  // here we are using this crypto which we imported from nodemodules which make the random strings
  const resetToken = crypto.randomBytes(32).toString('hex');

  this.passwordResetToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');
  console.log({ resetToken }, this.passwordResetToken);

  this.passwordResetExpires = Date.now() + 10 * 60 * 1000;

  return resetToken;
};

const User = mongoose.model('User', userSchema);
module.exports = User;
