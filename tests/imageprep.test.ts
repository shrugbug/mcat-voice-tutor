import { describe, expect, test } from 'vitest';
import { fitWithin, isAcceptedImageMime } from '../lib/imageprep';

describe('isAcceptedImageMime', () => {
  test.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s', (mime) => {
    expect(isAcceptedImageMime(mime)).toBe(true);
  });

  test.each(['image/gif', 'image/heic', 'application/pdf', '', 'IMAGE/JPEG'])(
    'rejects unsupported MIME %j',
    (mime) => {
      expect(isAcceptedImageMime(mime)).toBe(false);
    }
  );
});

describe('fitWithin', () => {
  test('keeps an image that already fits at its original dimensions', () => {
    expect(fitWithin(1200, 800, 1536)).toEqual({ width: 1200, height: 800 });
  });

  test('keeps an image whose longest edge exactly matches the maximum', () => {
    expect(fitWithin(1536, 900, 1536)).toEqual({ width: 1536, height: 900 });
  });

  test('fits a landscape image to the maximum width without changing its aspect ratio', () => {
    expect(fitWithin(3000, 2000, 1536)).toEqual({ width: 1536, height: 1024 });
  });

  test('fits a portrait image to the maximum height without changing its aspect ratio', () => {
    expect(fitWithin(1200, 2400, 1536)).toEqual({ width: 768, height: 1536 });
  });

  test('fits an oversized square to the maximum in both dimensions', () => {
    expect(fitWithin(2000, 2000, 1536)).toEqual({ width: 1536, height: 1536 });
  });

  test('rounds a scaled fractional dimension to the nearest whole pixel', () => {
    expect(fitWithin(2000, 1333, 1536)).toEqual({ width: 1536, height: 1024 });
  });
});
