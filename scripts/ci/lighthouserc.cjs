'use strict';

module.exports = {
  ci: {
    collect: {
      staticDistDir: '.lighthouse-site',
      url: ['http://localhost/', 'http://localhost/#/schedule', 'http://localhost/#/speakers'],
      numberOfRuns: 3,
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
