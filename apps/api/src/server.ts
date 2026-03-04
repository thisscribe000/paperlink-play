import "dotenv/config";
import app from "./app";

const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || "0.0.0.0";

app
  .listen({ port: PORT, host: HOST })
  .then((address: string) => {
    app.log.info(`API listening at ${address}`);
  })
  .catch((err: unknown) => {
    app.log.error(err);
    process.exit(1);
  });