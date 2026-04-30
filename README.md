# Payments Dashboard

A small Express-served dashboard that lists Halliday payments.

## Setup

```bash
npm install
npm start
```

Then open http://localhost:3000 in your browser.

## Adding your API key

1. Go to https://dashboard.halliday.xyz/ and copy your organization's **SECRET Authentication Token (internal)**.
2. Open `public/script.js` and set the `API_KEY` constant near the top of the file:

   ```js
   const API_KEY = "Bearer <your-secret-token>";
   ```

3. Save and reload the page.

> **Keep this token safe.** It is a secret key — do not commit it to source control or share it.
