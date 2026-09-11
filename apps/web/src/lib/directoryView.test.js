// lib/directoryView.js — the attendee directory's narrowing rules (issue
// #174).
import { describe, expect, it } from 'vitest';
import { collectOrganizations, directorySearchText, matchesDirectoryFilters } from './directoryView.js';

const people = [
  { id: 'p1', displayName: 'Alex Rivera', organization: 'Acme News', jobTitle: 'Editor' },
  { id: 'p2', displayName: 'Dana Smith', organization: 'Borealis Post', jobTitle: 'Reporter' },
  { id: 'p3', displayName: 'Ana Lopez', organization: 'Acme News', jobTitle: 'Publisher' },
  { id: 'p4', displayName: 'Bo Chen', organization: null, jobTitle: null },
];

describe('directorySearchText', () => {
  it('carries the name, the organization, and the role, folded', () => {
    expect(directorySearchText(people[0])).toBe('alex rivera acme news editor');
  });

  it('drops the parts a profile does not carry', () => {
    expect(directorySearchText(people[3])).toBe('bo chen');
  });
});

describe('matchesDirectoryFilters', () => {
  it('an empty query and an empty filter keep everybody', () => {
    for (const person of people) {
      expect(matchesDirectoryFilters(person, { q: '', organizations: [] })).toBe(true);
    }
  });

  it('the query matches the name, the organization, and the role, case-blind', () => {
    expect(matchesDirectoryFilters(people[2], { q: 'ana lopez' })).toBe(true);
    expect(matchesDirectoryFilters(people[2], { q: 'acme' })).toBe(true);
    expect(matchesDirectoryFilters(people[2], { q: 'publisher' })).toBe(true);
    expect(matchesDirectoryFilters(people[1], { q: 'kai' })).toBe(false);
  });

  it('the organization filter compares the stored value', () => {
    expect(matchesDirectoryFilters(people[0], { organizations: ['Acme News'] })).toBe(true);
    expect(matchesDirectoryFilters(people[1], { organizations: ['Acme News'] })).toBe(false);
    // A profile with no organization passes no organization filter.
    expect(matchesDirectoryFilters(people[3], { organizations: ['Acme News'] })).toBe(false);
  });

  it('a profile must pass both at once', () => {
    expect(matchesDirectoryFilters(people[0], { q: 'editor', organizations: ['Acme News'] })).toBe(true);
    expect(matchesDirectoryFilters(people[0], { q: 'editor', organizations: ['Borealis Post'] })).toBe(false);
  });
});

describe('collectOrganizations', () => {
  it('lists the organizations the directory carries, most first, ties alphabetical', () => {
    expect(collectOrganizations(people)).toEqual([
      { value: 'Acme News', label: 'Acme News', count: 2 },
      { value: 'Borealis Post', label: 'Borealis Post', count: 1 },
    ]);
  });

  it('offers nothing when no profile names an organization', () => {
    expect(collectOrganizations([people[3]])).toEqual([]);
  });
});
