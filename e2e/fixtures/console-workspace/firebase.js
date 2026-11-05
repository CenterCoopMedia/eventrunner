// Only the isolated browser fixture resolves the console's Firebase entry
// to this module. It has no SDK, credentials, or connection to a project.
export const auth = {
  currentUser: {
    uid: 'visual-console-operator',
    email: 'operator@example.test',
    emailVerified: true,
    getIdToken: async () => 'visual-fixture-token',
  },
};
export const app = {};
