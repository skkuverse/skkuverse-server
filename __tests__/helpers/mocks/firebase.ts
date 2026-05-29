/**
 * (A perimeter detail is left out of the public history.)
 *
 *
 */
interface FirebaseMockOptions {
  uid?: string;
  verifyIdToken?: jest.Mock;
}

const makeFirebaseMock = ({
  uid = "test-uid",
  verifyIdToken,
}: FirebaseMockOptions = {}) => ({
  auth: jest.fn().mockReturnValue({
    verifyIdToken: verifyIdToken || jest.fn().mockResolvedValue({ uid }),
  }),
});

export = makeFirebaseMock;
