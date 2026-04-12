// Mobile API v1 - تجميع كل الـ modules
const express = require('express');
const router = express.Router();

router.use('/', require('./users'));
router.use('/', require('./privacy'));
router.use('/', require('./premium'));
router.use('/', require('./blocking'));
router.use('/', require('./conversations'));
router.use('/', require('./messages'));
router.use('/', require('./notifications'));
router.use('/', require('./device'));
router.use('/', require('./reports'));

module.exports = router;
