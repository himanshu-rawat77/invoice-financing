const express = require('express');
const bidController = require('../controllers/bidController');
const authController = require('../controllers/authController');

const router = express.Router();

// Protect all routes after this middleware
router.use(authController.protect);

// Financer only routes
router.post('/', authController.restrictTo('financer'), bidController.placeBid);

router.get(
  '/my-bids',
  authController.restrictTo('financer'),
  bidController.getMyBids,
);

router.get(
  '/stats',
  authController.restrictTo('financer'),
  bidController.getBidStats,
);

router.patch(
  '/:id',
  authController.restrictTo('financer'),
  bidController.updateBid,
);

router.delete(
  '/:id',
  authController.restrictTo('financer'),
  bidController.cancelBid,
);

// Routes accessible by organization (bill owners) and financers
router.get('/bill/:billId', bidController.getBidsForBill);
router.get('/bill/:billId/highest', bidController.getHighestBid);
router.get('/:id', bidController.getBid);

// Organization only routes
router.patch(
  '/accept/:id',
  authController.restrictTo('organization'),
  bidController.acceptBid,
);

module.exports = router;
