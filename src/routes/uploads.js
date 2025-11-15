const { Router } = require('express');
const cloudinary = require('cloudinary').v2;
const asyncHandler = require('../middlewares/asyncHandler');
const requireAuth = require('../middlewares/requireAuth');

const router = Router();

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;
const UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET;

if (CLOUD_NAME && API_KEY && API_SECRET) {
  cloudinary.config({
    cloud_name: CLOUD_NAME,
    api_key: API_KEY,
    api_secret: API_SECRET
  });
}

router.post(
  '/sign',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!CLOUD_NAME || !API_KEY || !API_SECRET || !UPLOAD_PRESET) {
      return res.status(500).json({ message: 'Cloudinary is not configured' });
    }

    const { folder } = req.body || {};
    const timestamp = Math.round(Date.now() / 1000);
    const params = {
      timestamp,
      upload_preset: UPLOAD_PRESET
    };
    if (folder) {
      params.folder = folder;
    }

    const signature = cloudinary.utils.api_sign_request(params, API_SECRET);

    res.json({
      timestamp,
      signature,
      apiKey: API_KEY,
      cloudName: CLOUD_NAME,
      uploadPreset: UPLOAD_PRESET,
      folder
    });
  })
);

const extractPublicId = (url) => {
  if (!url || typeof url !== 'string' || !CLOUD_NAME) {
    return null;
  }
  try {
    const parsed = new URL(url);
    const expectedHost = `res.cloudinary.com`;
    if (!parsed.hostname.endsWith(expectedHost)) {
      return null;
    }
    if (!parsed.pathname.includes(`/${CLOUD_NAME}/`)) {
      return null;
    }
    const uploadSegment = parsed.pathname.split('/upload/')[1];
    if (!uploadSegment) {
      return null;
    }
    const withoutVersion = uploadSegment.replace(/^v\d+\//, '');
    return withoutVersion.replace(/\.[^.]+$/, '');
  } catch (err) {
    return null;
  }
};

router.post(
  '/cleanup',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!CLOUD_NAME || !API_SECRET) {
      return res.status(500).json({ message: 'Cloudinary is not configured' });
    }

    const { url } = req.body || {};
    if (!url) {
      return res.status(400).json({ message: 'Missing asset url' });
    }

    const publicId = extractPublicId(url);
    if (!publicId) {
      return res.status(400).json({ message: 'Unable to parse asset id' });
    }

    try {
      await cloudinary.uploader.destroy(publicId);
      res.json({ ok: true });
    } catch (err) {
      console.error('Cloudinary cleanup failed', err);
      res.status(500).json({ message: 'Failed to remove previous asset' });
    }
  })
);

module.exports = router;
