const express = require('express');
const billController = require('../controllers/billController');
const authController = require('../controllers/authController');

const router = express.Router();

// Protect all routes after this middleware
router.use(authController.protect);

// Routes for all authenticated users
router.get('/stats', billController.getBillsStats);
router.get('/my-bills', billController.getMyBills);
router.get('/status/:status', billController.getBillsByStatus);
router.get('/:id', billController.getBill);

// Organization only routes
router.post(
  '/',
  authController.restrictTo('organization'),
  billController.createBill,
);

router.patch(
  '/send/:id',
  authController.restrictTo('organization'),
  billController.sendBill,
);

router.patch(
  '/:id',
  authController.restrictTo('organization'),
  billController.updateBill,
);

router.delete(
  '/:id',
  authController.restrictTo('organization'),
  billController.deleteBill,
);

// Customer only routes
router.patch(
  '/pay/:id',
  authController.restrictTo('customer'),
  billController.payBill,
);

// Financer only routes
router.get(
  '/marketplace/available',
  authController.restrictTo('financer'),
  billController.getMarketplaceBills,
);

module.exports = router;
