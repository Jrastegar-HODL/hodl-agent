#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program.name("hodl-agent").description("Trade a Chamber vault on Base with your own key");

// Stubs: each command is implemented in steps 2.9 and 2.10.
const stub = (name: string) => () => {
  console.log(`${name}: not implemented yet`);
};

program.command("init").description("Create the trading key and save the HODL API URL").action(stub("init"));
program.command("onboard").description("Register the strategy and create its vault").action(stub("onboard"));
program.command("rebalance").description("Trade the vault to target weights").action(stub("rebalance"));
program.command("status").description("Show holdings, weights, share price and recent trades").action(stub("status"));
program.command("listen").description("Receive weight signals on a local endpoint").action(stub("listen"));

program.parse();
