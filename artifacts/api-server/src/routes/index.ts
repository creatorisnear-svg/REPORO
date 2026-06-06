import { Router, type IRouter } from "express";
import healthRouter from "./health";
import stripeRouter from "./stripe";
import setupRouter from "./setup";
import authRouter from "./auth";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(stripeRouter);
router.use(setupRouter);
router.use(authRouter);
router.use(dashboardRouter);

export default router;
