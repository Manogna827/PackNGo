# PackNGo

**PackNGo – Collaborative Trip Planning and Coordination System**  
Plan Together. Organize Everything. Travel Better.

PackNGo is a shared trip workspace for planning an itinerary, tracking group expenses and repayments, sharing tasks, and keeping trip images together. It is not a booking or payment-processing platform.

## Features

- Firebase Email/Password sign-up and login; Firebase UID is the authorization identity.
- Firestore-backed trips, one-time Firestore trip IDs, unique six-character invite codes, rejoining, and a 10-active-member limit.
- Shared itinerary, participant-aware expense splits, exact-cent balance calculation, repayment approval/rejection, task assignment, image upload, AI destination ideas, owner transfer, and trip/item restore history.
- Responsive vanilla HTML/CSS/JavaScript frontend served by the Express API.
- Private server credentials; browser receives only the public Firebase web configuration.

## Stack and layout

- Frontend: HTML5, CSS3, vanilla JavaScript modules, Firebase Authentication browser SDK.
- Backend: Node.js 22+, Express, Firebase Admin SDK.
- Data: Firebase Authentication and Cloud Firestore.
- Images: Cloudinary.
- Optional destination guide: Gemini API.
- Runtime packages: `@google/genai`, `cloudinary`, `cors`, `dotenv`, `express`, `express-rate-limit`, `firebase-admin`, `helmet`, and `multer`. The Firebase browser SDK is loaded from Google's official CDN.

```text
PackNGo/
  backend/
    config/firebase.js
    lib/{errors,finance,validation}.js
    middleware/authenticate.js
    routes/api.js
    services/cloudinary.js
    test/
    server.js
    .env.example
  frontend/
    css/style.css
    js/
    index.html
    login.html
    signup.html
    dashboard.html
    create-trip.html
    join-trip.html
    trip.html
    profile.html
  firestore.rules
  firebase.json
  package.json
```

## Firebase setup

1. Create a Firebase project and register a Web App.
2. In **Authentication → Sign-in method**, enable **Email/Password**.
3. Create a **Cloud Firestore** database in a region suitable for your users.
4. In **Project settings → General → Your apps**, copy the Web App API key, auth domain, project ID, and app ID into `backend/.env`.
5. In **Project settings → Service accounts**, create a private service-account key. Keep it server-side. Choose exactly one Admin credential method: put the full JSON on one line in `FIREBASE_SERVICE_ACCOUNT_JSON` (single-quote the value in `.env`), or fill in both `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY`. Do not fill in both methods.
6. Apply the rules in `firestore.rules` with the Firebase CLI (`npx firebase-tools deploy --only firestore:rules`). The browser does not read or write Firestore directly; authenticated API routes use Admin SDK and enforce trip membership.

The Admin service account must have access to Authentication user records and Firestore. **Never put its private key in `frontend/`, source control, or a browser build.** If a real private key or provider secret has ever been placed in a source file or shared, revoke/rotate it; removing the value from the file does not make the old credential safe again.

## Cloudinary and Gemini setup

- Create a Cloudinary account. Add the cloud name, API key, and API secret to the backend environment. The Express API accepts only JPG/JPEG, PNG, or WEBP images, validates image signatures, caps uploads at 10 MB, and stores URLs/captions in Firestore.
- Create a Gemini API key and add it as `GEMINI_API_KEY` on the backend. The destination guide is an optional feature; all other trip features work without it. No Gemini key is returned to the browser.

## Environment

Copy `backend/.env.example` to `backend/.env` and fill in:

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | No | HTTP port; defaults to `5000`. |
| `NODE_ENV` | No | Set `production` on the host. |
| `FIREBASE_PROJECT_ID` | Yes | Firebase project ID. |
| `FIREBASE_API_KEY` | Yes | Public Firebase Web App key (restrict it to your production domain in Google Cloud). |
| `FIREBASE_AUTH_DOMAIN` | Yes | Firebase Authentication domain. |
| `FIREBASE_APP_ID` | Yes | Firebase Web App ID. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | One Admin method | Full service-account JSON on one line in `.env`, single-quoted. Leave the pair below empty when using this. |
| `FIREBASE_CLIENT_EMAIL` | Alternative Admin method | Admin service account email; set together with `FIREBASE_PRIVATE_KEY`, and leave the JSON variable empty. |
| `FIREBASE_PRIVATE_KEY` | Alternative Admin method | Admin service account private key; set together with `FIREBASE_CLIENT_EMAIL`. Newlines may be written as `\n`. |
| `ALLOWED_ORIGINS` | Production | Comma-separated exact origins allowed for cross-origin requests. Same-origin app requests need no cross-origin deployment. |
| `CLOUDINARY_CLOUD_NAME` | For uploads | Cloudinary account cloud name. |
| `CLOUDINARY_API_KEY` | For uploads | Cloudinary API key. |
| `CLOUDINARY_API_SECRET` | For uploads | Server-only Cloudinary API secret. |
| `GEMINI_API_KEY` | For destination guide | Server-only Gemini key. |
| `FIRESTORE_EMULATOR_HOST` | Local emulator only | For example `127.0.0.1:8080`. |
| `FIREBASE_AUTH_EMULATOR_HOST` | Local emulator only | For example `127.0.0.1:9099`. |

Do not commit `.env`. The Firebase Web App key is client configuration, not an Admin credential; still apply API restrictions and authorized domains.

## Local development

Use Node.js 22 or newer. From the PackNGo project directory:

```sh
copy backend\.env.example backend\.env
# Add your Firebase values to backend\.env
npm install
npm test
npm run dev
```

Open `http://localhost:5000`. `npm start` runs the same Express server without watch mode. If port 5000 is busy, set `PORT` in `backend/.env` and use the printed URL.

For a local backend with the Firebase Emulator Suite, start the Auth and Firestore emulators, set both emulator host variables and the Firebase project ID, then run PackNGo. Emulator sign-up and trip-sharing tests still use real Firebase Auth/Firestore Emulator operations; the application does not silently switch to local mock storage.

## Firestore structure

```text
users/{firebaseUid}
inviteCodes/{sixCharacterCode}             -> tripId
trips/{firestoreTripId}
  itinerary/{itemId}
  expenses/{expenseId}
  tasks/{taskId}
  documents/{documentId}
  settlements/{settlementId}
  history/{historyId}
```

Trip member status is stored in `trips/{tripId}.members`; `activeMemberIds` supports efficient shared-trip listing and is kept in step with member join/leave transactions. Subcollection entries include their parent `tripId`. Deleted trip items are soft-deleted with actor/time metadata and copied into history so the original item ID and data can be restored. Only the owner can restore deleted items or trips.

All money is rounded to integer paise (cents). An expense’s fair-share paise is allocated deterministically across its saved participant IDs; the first IDs alphabetically receive any leftover paise. Historical participant lists do not change when the trip membership changes. Pending repayments never affect balances; only recipient-approved payments do.

## API endpoints

All endpoints except `/api/config` and `/api/health` require `Authorization: Bearer <Firebase ID token>`.

| Area | Endpoints |
| --- | --- |
| Health/config | `GET /api/health`, `GET /api/config` |
| Profile | `GET /api/auth/profile`, `PATCH /api/auth/profile` |
| Trips | `POST /api/trips`, `GET /api/trips`, `GET /api/trips/trash`, `GET /api/trips/:tripId`, `GET /api/trips/:tripId/full`, `POST /api/trips/join`, `POST /api/trips/:tripId/leave`, `DELETE /api/trips/:tripId`, `POST /api/trips/:tripId/restore` |
| Itinerary | `GET/POST /api/trips/:tripId/itinerary`, `PATCH/DELETE /api/trips/:tripId/itinerary/:itemId` |
| Expenses | `GET /api/trips/:tripId/expenses`, `POST /api/trips/:tripId/expenses`, `PATCH/DELETE /api/trips/:tripId/expenses/:expenseId`, `GET /api/trips/:tripId/expenses/summary` |
| Settlements | `GET/POST /api/trips/:tripId/settlements`, `POST /api/trips/:tripId/settlements/:settlementId/approve`, `POST /api/trips/:tripId/settlements/:settlementId/reject` |
| Tasks | `GET/POST /api/trips/:tripId/tasks`, `PATCH/DELETE /api/trips/:tripId/tasks/:taskId` |
| Documents | `GET/POST /api/trips/:tripId/documents`, `PATCH/DELETE /api/trips/:tripId/documents/:documentId` (multipart upload field: `image`, plus `caption`) |
| History | `GET /api/trips/:tripId/history`, `POST /api/trips/:tripId/history/:historyId/restore` |
| AI | `POST /api/destination-guide` |

## Testing

Run `npm test` for automated unit tests covering the two required expense-calculation examples, settlement effects, rounding conservation, historical participation, and server-side input validation.

For a real two-account API acceptance run, start the Auth and Firestore emulators in one terminal:

```sh
npx firebase-tools emulators:start --only auth,firestore --project demo-packngo
```

In a second terminal, configure `backend/.env` with `FIREBASE_PROJECT_ID=demo-packngo`, `FIREBASE_API_KEY=fake-api-key`, `FIREBASE_AUTH_DOMAIN=localhost`, `FIREBASE_APP_ID=demo-packngo`, `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`, and `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`, then start the app:

```sh
npm start
```

In a third terminal, set `RUN_FIREBASE_ACCEPTANCE=1` and run `npm run test:acceptance`. In PowerShell, use `$env:RUN_FIREBASE_ACCEPTANCE='1'; npm run test:acceptance`. This test exercises separate accounts, shared data, edit visibility, settlement approval, authorization, soft-delete/restore, rejoin, and the 10-member limit against the actual Firebase emulators. Live Firebase, Cloudinary, and Gemini credentials are not included in this source tree, so no live provider acceptance test is claimed.

`RUN_FIREBASE_ACCEPTANCE` and the optional `PACKNGO_API_URL` override are test-runner settings only; they are not needed in the app's `.env` for normal use.

## Deployment

The frontend is static HTML/CSS/JavaScript, but it is not a standalone app: sign-in configuration and all trip operations call the Express API. To deploy the frontend to Vercel without changing those operations, deploy the existing API separately and let Vercel proxy `/api/*` to it.

### 1. Rotate exposed credentials before deployment

The previous `backend/.env.example` contained live-looking provider credentials. Revoke and replace the Firebase Admin service-account key, Cloudinary API secret, and Gemini API key in their provider consoles before deploying. Replace any affected local environment values and Render secrets with the new credentials. Removing a credential from this example file does not revoke it or remove it from Git history. Restrict the Firebase Web API key to the deployed domains.

### 2. Deploy the API to Render

1. Push the PackNGo project directory to a Git provider. In Render, create a **Blueprint** from that repository and choose the directory containing `render.yaml` if the PackNGo app is nested inside a larger repository.
2. Render reads `render.yaml` and creates the `packngo-api` Node service. If setting it up manually instead, use Node.js 22 or newer, build command `npm ci`, start command `npm start`, and health check path `/api/health`.
3. In the Render service's **Environment** settings, set the Firebase values. Provide `FIREBASE_SERVICE_ACCOUNT_JSON` with the new service-account JSON, or leave it empty and provide both `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY`; do not configure both methods. The Web App values (`FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, and `FIREBASE_APP_ID`) are also required.
4. Add the new Cloudinary values to enable image uploads and the new `GEMINI_API_KEY` to enable destination ideas. Those integrations are optional; keep the respective variables unset if they are not configured.
5. Deploy the service and wait for it to become healthy. Copy its HTTPS service URL (for example, `https://packngo-api.onrender.com`) for the next step. Test `https://<your-render-host>/api/health`; it should report a connected database.

Do not set `PORT` manually on Render; Render supplies it. The free Render plan may spin down when idle, so the first request after inactivity can be slow.

### 3. Point Vercel at the API

1. Open `frontend/vercel.json` and replace `https://YOUR-RENDER-BACKEND.onrender.com` with the exact Render URL from step 2. Keep `/api/:path*` at the end of the destination.
2. Commit and push this change.

This rewrite is important: the existing browser code continues calling relative `/api/...` URLs, and Vercel forwards those requests to the existing Express endpoints. Do not change the frontend API paths.

### 4. Deploy the frontend to Vercel

1. Import the repository into Vercel.
2. Set **Root Directory** to `frontend` (enable the option to include files outside that directory only if your Vercel setup asks for it; the frontend itself uses no build step).
3. Choose **Other** as the framework preset. Leave the build command empty and use `.` as the output directory if Vercel requests one. Vercel will serve the existing HTML pages and apply `frontend/vercel.json`.
4. Deploy and copy the production HTTPS URL, such as `https://your-app.vercel.app`.
5. In Render's service environment, set `ALLOWED_ORIGINS` to that exact Vercel origin (no trailing slash), then redeploy/restart the API. For a custom domain, include its exact origin too, comma-separated.
6. In Firebase Console → **Authentication → Settings → Authorized domains**, add the Vercel hostname and any custom domain. Apply the appropriate HTTP referrer restrictions to the Firebase Web API key.

### 5. Verify the deployed app

1. Open `https://<your-vercel-host>/api/health`; it should return the API health response through the Vercel rewrite.
2. Open the Vercel homepage, create/sign in to an account, and test trip creation and joining, itinerary, expenses and repayment approval, tasks, and documents/uploads if Cloudinary is configured.
3. Check the Render logs and browser developer console if any call fails. Confirm the Vercel rewrite has the correct Render URL and `ALLOWED_ORIGINS` exactly matches the browser site's HTTPS origin.

The original single-service deployment remains available: hosting the project root as a Node.js web service serves both the frontend and API from one origin. Do not publish `.env` or provider credentials. The project does not process bookings or move money.
