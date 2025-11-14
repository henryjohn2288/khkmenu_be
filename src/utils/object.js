const pick = (obj, keys) =>
  Object.entries(obj || {}).reduce((acc, [key, value]) => {
    if (keys.includes(key) && value !== undefined) {
      acc[key] = value;
    }
    return acc;
  }, {});

module.exports = { pick };
