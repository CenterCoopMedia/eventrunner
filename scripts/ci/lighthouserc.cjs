'use strict';

module.exports = {
  ci: {
    collect: {
      staticDistDir: '.lighthouse-site',
      url: ['http://localhost/', 'http://localhost/#/schedule', 'http://localhost/#/speakers'],
      // The first two samples have spiked on unchanged hosted builds (#1389).
      numberOfRuns: 5,
      settings: {
        onlyCategories: ['performance'],
        formFactor: 'mobile',
        throttlingMethod: 'simulate',
      },
    },
    assert: {
      assertions: {
        'largest-contentful-paint': ['error', { maxNumericValue: 2500, aggregationMethod: 'median' }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1, aggregationMethod: 'median' }],
        'total-blocking-time': ['error', { maxNumericValue: 2000, aggregationMethod: 'median' }],
      },
    },
  },
};
