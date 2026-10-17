require("dotenv").config();

const app = require("./api/index");

const mongoURI = process.env.MONGO_URL || "mongodb://0.0.0.0:27017";
const PORT = process.env.PORT || 5001;

console.log(process.env.MONGO_URL);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
