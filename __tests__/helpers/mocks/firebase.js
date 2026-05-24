/**
 * (A perimeter detail is left out of the public history.)
 *
 *
 *
 *
 */
module.exports = function makeFirebaseMock({ uid = "test-uid", verifyIdToken } = {}) {
  return {
    auth: jest.fn().mockReturnValue({
      verifyIdToken: verifyIdToken || jest.fn().mockResolvedValue({ uid }),
    }),
  };
};
