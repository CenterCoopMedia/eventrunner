import promoCodes from './promoCodes.cjs';

export const {
  PROMO_ERRORS,
  PROMO_KINDS,
  MAX_PROMO_USES,
  normalizePromoCode,
  validatePromoCode,
  discountedUnitAmount,
  applyPromoCode,
} = promoCodes;
