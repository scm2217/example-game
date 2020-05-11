import {
  Agent,
  Room,
  Info,
  Trade,
  Item,
  Conversation,
  ClientAPI,
  getPanoptykDatetime,
  logger,
  ActionGiveQuest
} from "panoptyk-engine/dist/client";
import questHelp from "./util/questHelper";
import * as KB from "./kb/KBadditions";

// Boilerplate agent code ================================================== START
const username = process.argv[2] ? process.argv[2] : "Chief";
const password = process.argv[3] ? process.argv[3] : "password";
const address = process.argv[4] ? process.argv[4] : "http://localhost:8080";

const MAX_RETRY = 10;
const RETRY_INTERVAL = 100; // ms before attempLogin() is called again to retry logging in
const ACT_INTERVAL = 200; // ms before act() is called again(possibly)

function init() {
  console.log("Logging in as: " + username + "\nTo server: " + address);
  logger.silence();
  address ? ClientAPI.init(address) : ClientAPI.init();
  process.on("SIGINT", () => {
    if (!_loggedIn) {
      process.exit(0);
    } else {
      _endBot = true;
    }
  });
  attemptLogin();
}

let _retries = 1;
let _loggedIn = false;
function attemptLogin() {
  ClientAPI.login(username, password)
    .catch(res => {
      console.log("Failed(%d)....retrying...", _retries);
      if (_retries <= MAX_RETRY) {
        _retries++;
        // tslint:disable-next-line: ban
        setTimeout(attemptLogin, RETRY_INTERVAL);
      }
    })
    .then(res => {
      console.log("Logged in!");
      _loggedIn = true;
      // tslint:disable-next-line: ban
      setTimeout(actWrapper, 200);
    });
}

let _acting = false;
let _endBot = false;
function actWrapper() {
  if (!_acting) {
    _acting = true;
    act()
      .catch(err => {
        console.log(err);
      })
      .finally(() => {
        _acting = false;
      });
  }
  if (!_endBot) {
    // tslint:disable-next-line: ban
    setTimeout(actWrapper, ACT_INTERVAL);
  } else {
    console.log("bot exiting...");
    process.exit(0);
  }
}
// Boilerplate agent code ================================================== END
// set "_endBot" to true to exit the script cleanly

const DoQuest = async function() {
  const otherAgent = KB.get.otherAgentInConvo();
  if (questHelp.canGiveQuest(otherAgent)) {
    await questHelp.giveQuest(otherAgent);
    return true;
  }
  return false;
};

async function act() {
  if (ClientAPI.playerAgent.conversation) {
    if (! await DoQuest()) {
      await questHelp.tryCompleteQuest();
    }
  } else if (ClientAPI.playerAgent.conversationRequesters.length > 0) {
    await ClientAPI.acceptConversation(
      ClientAPI.playerAgent.conversationRequesters[0]
    );
  }
}

// =======Start Bot========== //
/*       */ init(); /*        */
// ========================== //