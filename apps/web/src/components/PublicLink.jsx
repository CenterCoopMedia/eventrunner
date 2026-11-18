import { forwardRef } from 'react';
import { Link, NavLink, createPath, useResolvedPath } from 'react-router';
import { usePublicLanguage } from '../contexts/PublicLanguageContext.jsx';

function usePublicTarget(to, relative) {
  const { localize } = usePublicLanguage();
  const resolved = useResolvedPath(to, { relative });
  if (!to || (typeof to === 'string' && /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(to))) return to;
  const href = createPath(resolved);
  const target = localize(href);
  return target === href ? to : target;
}

export const PublicLink = forwardRef(function PublicLink({ to, relative, ...props }, ref) {
  return <Link ref={ref} to={usePublicTarget(to, relative)} relative={relative} {...props} />;
});

export const PublicNavLink = forwardRef(function PublicNavLink({ to, relative, ...props }, ref) {
  return <NavLink ref={ref} to={usePublicTarget(to, relative)} relative={relative} {...props} />;
});
