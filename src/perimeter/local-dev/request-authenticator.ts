import admin from "firebase-admin";
import { RequestAuthenticator, type Authentication, type PerimeterDeps, type PerimeterRequest } from "../perimeter.ports";
import { announceLocalDev } from "./local-dev-banner";

function createVerifier(projectId: string) {
  const app = admin.initializeApp({ projectId }, "perimeter-local-dev");
  return (idToken: string) => admin.auth(app).verifyIdToken(idToken);
}

// WHY: a named app of its own, made on first use, so constructing touches no Firebase state and the default app
// another module initializes is never reused or replaced.
let verifyLocalDevToken: ReturnType<typeof createVerifier> | undefined;

export class LocalDevRequestAuthenticator extends RequestAuthenticator {
  constructor(private readonly deps: PerimeterDeps) {
    super();
    announceLocalDev(deps, "requestAuthenticator");
  }

  async authenticate(request: PerimeterRequest): Promise<Authentication> {
    const authorization = request.header("authorization");
    if (!authorization?.startsWith("Bearer ")) return { kind: "anonymous" };
    verifyLocalDevToken ??= createVerifier(this.deps.firebaseProjectId);
    try {
      const decoded = await verifyLocalDevToken(authorization.slice("Bearer ".length));
      return { kind: "user", uid: decoded.uid, signInProvider: decoded.firebase.sign_in_provider };
    } catch {
      return { kind: "rejected" };
    }
  }
}
