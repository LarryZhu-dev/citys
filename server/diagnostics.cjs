'use strict';

// Stable operational categories only: never return/log driver messages, SQL,
// connection URLs, hostnames, usernames, passwords or error stacks.
function storageDiagnostic(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  const message = typeof error?.message === 'string' ? error.message : '';
  let category = 'DB_UNKNOWN', retryable = false;
  if (/unsupported startup parameter|unsupported.*(?:statement_timeout|lock_timeout)/i.test(message)) category = 'DB_POOLER_OPTIONS_UNSUPPORTED';
  else if (['28P01', '28000'].includes(code)) category = 'DB_AUTH_FAILED';
  else if (code === '3D000') category = 'DB_DATABASE_MISSING';
  else if (code === '42501') category = 'DB_PERMISSION_DENIED';
  else if (code === '42P01') category = 'DB_SCHEMA_MISSING';
  else if (['ERR_INVALID_URL', 'ERR_INVALID_ARG_TYPE'].includes(code)) category = 'DB_CONNECTION_CONFIG';
  else if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) { category = 'DB_DNS_FAILED'; retryable = true; }
  else if (['ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(code) || /connection.*tim(?:ed? ?out|eout)|timeout.*connect/i.test(message)) { category = 'DB_CONNECTION_TIMEOUT'; retryable = true; }
  else if (['ECONNREFUSED', 'ECONNRESET', 'EPIPE', '08001', '08006', '57P01', '57P02', '57P03'].includes(code)) { category = 'DB_CONNECTION_FAILED'; retryable = true; }
  else if (code === '53300') { category = 'DB_CONNECTION_LIMIT'; retryable = true; }
  else if (['ERR_TLS_CERT_ALTNAME_INVALID', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'CERT_HAS_EXPIRED', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(code) || /certificate|SSL connection is required|does not support SSL/i.test(message)) category = 'DB_TLS_FAILED';
  else if (/SASL|SCRAM|channel binding/i.test(message)) category = 'DB_AUTH_PROTOCOL';
  else if (code === '57014' || message === 'Query read timeout') { category = 'DB_QUERY_TIMEOUT'; retryable = true; }
  else if (code === '55P03') { category = 'DB_LOCK_TIMEOUT'; retryable = true; }
  return {category, retryable};
}

function reportStorageError(error) {
  console.error(JSON.stringify({event:'storage_failure', ...storageDiagnostic(error)}));
}

module.exports = {storageDiagnostic, reportStorageError};
