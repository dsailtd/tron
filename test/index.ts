import { Transaction, Tron } from "../src/index";

// Know Derived Addresses, They have balance on the Shasta network
const addressCheck = {
  100: "TUfzSqg7C5ED2EnaXTTocTxPwFwXRxnhsp",
  1000: "TSHjEK1QXeipenKk7TZT5Tqr1zpSa5Jce1",
};

console.log("==== THIS IS TESTING DO NOT USE THESE KEYS LIVE ====");

// Create Object
const tron = new Tron(
  "season predict random cool daughter predict squeeze use mosquito smart around panic"
);

// First run verbose output
let first = true;

// Listen to new confirmed transactions and get the balance
tron.on("transactions", (transaction: Transaction) => {
    if (first) {
      if (transaction.address === addressCheck[100]) {
        first = false;
        if (
          transaction.transactions.trx[0].txID ===
          "6ec098928ca3be8a4cfac821e59c184e3fa7ab128d86e7d988281a8e1dd3e3e0"
        ) {
          console.log("First Polled transaction is correct");
        }
      }
    }
  
    console.log("Event Emitted");
    console.log(transaction);
  });


// Let it build (maybe make event)
setTimeout(async () => {    
  // Get Known Address
  const key = await tron.getHDAddress(100);
  const keyTo = await tron.getHDAddress(1000);
  console.log(keyTo);

  // check it
  if (key == addressCheck[100] && keyTo == addressCheck[1000]) {
    console.log("Single(s) HD Key Check complete");
    console.log("Starting Polling");

    // Start Polling from a known time
    tron.startPolling(1646916052313);

    // Wait more then send a small value transaction to keyTo
    setTimeout(async () => {
      console.log("Generate TRX transaction & sending");
      const receipt = await tron.keyManager.sendTrx(
        100,
        10,
        addressCheck[1000]
      );
      console.log(receipt);
    }, 5000);
  } else {
    console.log("Single Key check FAILED");
  }
}, 2000);



