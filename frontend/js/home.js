import { firebaseReady } from "./firebase.js";
import { showPageError } from "./utils.js";

firebaseReady.catch(showPageError);
