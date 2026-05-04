const path = require("path");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`Payments Dashboard running at http://localhost:${PORT}`);
});
