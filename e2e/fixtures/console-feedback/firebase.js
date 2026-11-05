// Resolved only by this spec's isolated Vite server. No SDK or live project.
export const auth = {
  currentUser: {
    uid: 'visual-owner', email: 'organizer@example.test', emailVerified: true,
    getIdToken: async () => 'console-feedback-fixture-token',
  },
};
export const app = {};
