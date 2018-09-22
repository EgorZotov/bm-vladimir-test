'use strict';

const Router = require('koa-router');
const homeController = require('./controllers/home');


const router = new Router();
router.get('/', homeController.getPoll);
router.get('/user/:userId',  homeController.getUserPolls);
router.post('/create', homeController.makePoll);

router.post('/poll/:pollId/close', homeController.closePoll);

router.post('/poll/:pollId', homeController.vote);
module.exports = router;
