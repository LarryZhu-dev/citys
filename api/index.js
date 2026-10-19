'use strict';
const { createApp } = require('../server/app.cjs');
const { vercelHandler } = require('../server/vercel.cjs');
const { reportStorageError } = require('../server/diagnostics.cjs');
module.exports = vercelHandler(createApp({onError:reportStorageError}));
