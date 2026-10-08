import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
import { describe, expect, it } from 'vitest';

// Branding's iframe copies eagerly loaded styles before it renders a lazy
// public route. Keep this stylesheet in that initial set and after the
// shared rules whose compact layout it refines.
describe('Program stylesheet delivery', () => {
  it('loads with the app after the shared stylesheet, including cold Branding previews', () => {
    const main = fs.readFileSync(path.resolve(here, '../main.jsx'), 'utf8');
    const schedule = fs.readFileSync(path.resolve(here, '../pages/Schedule.jsx'), 'utf8');
    expect(main).toMatch(/import '\.\/index\.css';[\s\S]*import '\.\/styles\/schedule\.css';/);
    expect(schedule).not.toContain("import '../styles/schedule.css'");
  });
});
