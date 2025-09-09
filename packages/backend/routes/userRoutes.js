const express = require('express');
const userController = require('./../controllers/userController');
const authController = require('./../controllers/authController');

const router = express.Router();

//Below code is also a middleware function
//we have signup as special endpoint it dosent come in REST architechure

router.post('/signup', authController.signUp); // this is only related to the user
router.post('/login', authController.login);

router.post('/forgotPassword', authController.forgetPassword);
router.patch('/resetPassword/:token', authController.resetPassword);

//we know that protect function below is a middleware and we know middleware runs always in sequence so this below code will run before any code below it written so now we are able to put (authController.protect) this code on all the below routes so now we can remove this function from all the routes and the code will work same as before

router.use(authController.protect); // this will protect all the routes that come after this point

// Routes for all authenticated users
router.get('/dashboard', userController.getDashboard);
router.get('/stats', userController.getUserStats);
router.get('/activity-feed', userController.getActivityFeed);
router.patch('/updateMyPassword', authController.updatePassword);
router.patch('/updateProfile', userController.updateProfile);
router.post('/upload-verification', userController.uploadVerificationDocument);

// Organization only routes
router.get(
  '/customers',
  authController.restrictTo('organization'),
  userController.getCustomers,
);

// Financer only routes
router.patch(
  '/add-funds',
  authController.restrictTo('financer'),
  userController.addFunds,
);

router.patch(
  '/updateMyPassword',

  authController.updatePassword,
);

router.get(
  '/me',

  userController.getMe,
  userController.getUser,
);
router.patch('/updateMe', userController.updateMe);
router.delete('/deleteMe', userController.deleteMe);

//here this follows 100% REST philosphy where the name of the url has nothing to with the action that is performed
//here below all of the actions should only we executed by admin
router.use(authController.restrictTo('admin')); //so now this middleware run before below codes as middlewares run in sequence and this will only allow to impliment below code

router
  .route('/')
  .get(userController.getAllUsers)
  .post(userController.createUser);
router
  .route('/:id')
  .get(userController.getUser)
  .patch(userController.updateUser)
  .delete(userController.deleteUser);

module.exports = router;
