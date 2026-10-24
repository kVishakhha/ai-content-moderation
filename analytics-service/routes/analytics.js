const express = require('express');
const requireAdmin = require('../middleware/requireAdmin');
const createAnalyticsController = require('../controllers/analyticsController');

function createAnalyticsRouter(pool) {
  const router = express.Router();
  const controller = createAnalyticsController(pool);
  router.use(requireAdmin);
  router.get('/summary', controller.getSummary);
  router.get('/reviews', controller.getReviews);
  router.patch('/reviews/:reviewId', controller.resolveReview);
  return router;
}

module.exports = createAnalyticsRouter;
