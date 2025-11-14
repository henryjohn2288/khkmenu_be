function createHttpError(status, message) {
  const err = new Error(message);
  err.statusCode = status;
  return err;
}

module.exports = { createHttpError };
