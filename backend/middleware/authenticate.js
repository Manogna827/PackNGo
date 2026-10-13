import { auth } from "../config/firebase.js";
import { HttpError, asyncRoute } from "../lib/errors.js";

export const authenticate = asyncRoute(async (req, _res, next) => {
  const header = req.get("authorization") || "";
  const match = /^Bearer ([^\s]+)$/.exec(header);
  if (!match) throw new HttpError(401, "Sign in to continue.");
  try {
    const decoded = await auth.verifyIdToken(match[1], true);
    req.user = {
      uid: decoded.uid,
      email: decoded.email || "",
      name: decoded.name || decoded.email?.split("@")[0] || "Trip member"
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(401, "Your session has expired. Sign in again.");
  }
  next();
});
