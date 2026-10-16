import dotenv from "dotenv";
import { envMode } from "./required-env";

// WHY: a test must not read a developer's rendered .env, whose real values beat jest.setup.ts's dummies;
// imported first by config.ts, so every other module still sees the file's values outside tests.
if (!envMode(process.env).isTest) dotenv.config();
