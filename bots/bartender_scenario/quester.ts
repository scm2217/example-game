import { Agent, Room, Info, Trade, Item, Conversation, ClientAPI, Quest, IDObject } from "panoptyk-engine/dist/";
import * as Helper from "../helper";

const username = process.argv.length >= 3 ? process.argv[2] : "James Bond";
const password = process.argv.length > 3 ? process.argv[3] : "password";
const HOME_ID = 1;
let acting = false;
let state = "wait";
const talked = new Set<Agent>();
// conversation related variables
let conUpdate: number;
let prevInfoLen: number;
let asked = false;
// quest related variables
let activeQuest: Quest;
const exploredInfo = new Set<Info>();
let currentLeads: Info[] = [];
let currentTarget: Agent;
let questState: string;
let solution: Info;

/**
 * Main triggers act at random time interval when possible
 */
function main() {
    if (!acting) {
        acting = true;
        act().catch(err => {
            console.log(err);
        }).finally(() => {
            acting = false;
        });
    }
    // tslint:disable-next-line: ban
    setTimeout(main, Helper.randomInt(100, 200));
}

function prepForConversation() {
    conUpdate = 0;
    prevInfoLen = 0;
    asked = false;
}

/**
 * Act picks an action to execute based on the bot's perception of the world
 */
async function act() {
    state = ClientAPI.playerAgent.activeAssignedQuests.length ? "quest" : "wait";
    if (state === "wait") {
        if (ClientAPI.playerAgent.room.id !== HOME_ID && !ClientAPI.playerAgent.inConversation()) {
            await dumbNavigateStep(HOME_ID);
        }
        else {
            await waitHandler();
        }
    }
    else if (state === "quest") {
        await questHandler();
    }
}

/**
 * this should eventually be replaced by a real navigation algorithm
 */
async function dumbNavigateStep(roomID: number) {
    if (ClientAPI.playerAgent.room.id !== roomID) {
        const potentialRooms = ClientAPI.playerAgent.room.getAdjacentRooms();
        const dest = potentialRooms.find(room => room.id === roomID);
        if (dest) await ClientAPI.moveToRoom(dest);
        else await ClientAPI.moveToRoom(potentialRooms[Helper.randomInt(0, potentialRooms.length)]);
    }
}

async function waitHandler() {
    if (ClientAPI.playerAgent.conversation) {
        const other: Agent = Helper.getOthersInConversation()[0];
        conUpdate = conUpdate ? conUpdate : Date.now();
        prevInfoLen = prevInfoLen ? prevInfoLen : ClientAPI.playerAgent.getInfoByAgent(other).length;

        // give other agent time to interact and extend timer when they tell us something
        const infoLen = ClientAPI.playerAgent.getInfoByAgent(other).length;
        if (Date.now() - conUpdate <= Helper.WAIT_FOR_OTHER || prevInfoLen < infoLen) {
            if (prevInfoLen < infoLen) {
                prevInfoLen = infoLen;
                conUpdate = Date.now();
            }
        }
        else {
            await ClientAPI.leaveConversation(ClientAPI.playerAgent.conversation);
        }
    }
    else {
        // accept conversations from approaching agents if they are a high ranking member in same faction
        for (const requester of ClientAPI.playerAgent.conversationRequesters) {
            if (requester.rank === 0 && requester.faction === ClientAPI.playerAgent.faction) {
                prepForConversation();
                await ClientAPI.acceptConversation(requester);
                return;
            }
            else {
                await ClientAPI.rejectConversation(requester);
            }
        }
    }
}

async function completeQuest() {
    if (ClientAPI.playerAgent.inConversation()) {
        await ClientAPI.completeQuest(activeQuest, solution);
        console.log("Quest complete " + activeQuest);
        activeQuest = undefined;
    }
    else if (ClientAPI.playerAgent.room.hasAgent(activeQuest.giver)) {
        if (!ClientAPI.playerAgent.activeConversationRequestTo(activeQuest.giver)) {
            console.log("Requesting quest giver: " + activeQuest.giver);
            prepForConversation();
            await ClientAPI.requestConversation(activeQuest.giver);
        }
    }
    else {
        // attempt to find agent
        const lastLoc = Helper.findLastKnownLocation(activeQuest.giver);
        await dumbNavigateStep(lastLoc ? lastLoc.id : 0);
    }
}

async function questQuestionSolver() {
    if (questState === "evaluating") {
        // Check if we have obtained answer
        const potentialAns = ClientAPI.playerAgent.getInfoByAction(activeQuest.task.action);
        for (const info of potentialAns) {
            if (activeQuest.checkSatisfiability(info)) {
                console.log("Turning in quest " + activeQuest);
                questState = "turnIn";
                solution = info;
                return;
            }
        }
        // if we didnt find solution with info we have
        questState = "searching";
    }
    if (questState === "turnIn") {
        await completeQuest();
        return;
    }
    if (currentTarget === undefined) {
        if (currentLeads.length === 0) {
            for (const told of ClientAPI.playerAgent.getInfoByAction("TOLD")) {
                const terms = told.getTerms();
                if (!exploredInfo.has(told) && terms.info.isAnswer(activeQuest.task) &&
                !(terms.agent1 === ClientAPI.playerAgent || terms.agent2 === ClientAPI.playerAgent)) {
                    currentLeads.push(told);
                    exploredInfo.add(told);
                    console.log("Potential lead: " + told.infoID);
                }
            }
        }
        currentTarget = currentLeads.pop().getTerms().agent1;
        console.log("Looking for " + currentTarget);
    }
    if (questState === "searching") {
        if (ClientAPI.playerAgent.trade) {
            const trade: Trade = ClientAPI.playerAgent.trade;
            const other: Agent = Helper.getOtherInTrade();
            let targetInfo: Info = undefined;
            for (const info of trade.getAgentInfosData(other)) {
                if (info.isAnswer(activeQuest.task, activeQuest.task.getTerms())) {
                    targetInfo = info;
                    break;
                }
            }
            // offer whatever we need to get info
            if (targetInfo) {
                for (const [item, response] of trade.getAgentsRequestedItems(other)) {
                    if (!trade.agentOfferedItem(ClientAPI.playerAgent, item) && ClientAPI.playerAgent.hasItem(item)) {
                        await ClientAPI.offerItemsTrade([item]);
                    }
                }
                if (!trade.getAgentReadyStatus(ClientAPI.playerAgent)) {
                    conUpdate = Date.now();
                    await ClientAPI.setTradeReadyStatus(true);
                    return;
                }
            }
        }
        else if (ClientAPI.playerAgent.inConversation()) {
            const convo: Conversation = ClientAPI.playerAgent.conversation;
            const other: Agent = Helper.getOthersInConversation()[0];
            talked.add(other);
            conUpdate = conUpdate ? conUpdate : Date.now();
            prevInfoLen = prevInfoLen ? prevInfoLen : ClientAPI.playerAgent.getInfoByAgent(other).length;
            if (!asked) {
                await ClientAPI.askQuestion(activeQuest.task.getTerms());
                asked = true;
                return;
            }
            const tradeReq = ClientAPI.playerAgent.tradeRequesters;
            if (tradeReq.length > 0) {
                await ClientAPI.acceptTrade(other);
                conUpdate = Date.now();
                return;
            }
            // give other agent time to interact and extend timer when they tell us something
            const infoLen = ClientAPI.playerAgent.getInfoByAgent(other).length;
            if (Date.now() - conUpdate <= Helper.WAIT_FOR_OTHER || prevInfoLen < infoLen) {
                if (prevInfoLen < infoLen) {
                    prevInfoLen = infoLen;
                    conUpdate = Date.now();
                }
            }
            else {
                await ClientAPI.leaveConversation(ClientAPI.playerAgent.conversation);
            }
        }
        else if (talked.has(currentTarget)) {
            console.log("Finished talking to " + currentTarget);
            questState = "evaluating";
            currentTarget = undefined;
        }
        else {
            if (ClientAPI.playerAgent.room.hasAgent(currentTarget)) {
                if (!ClientAPI.playerAgent.activeConversationRequestTo(currentTarget)) {
                    prepForConversation();
                    await ClientAPI.requestConversation(currentTarget);
                }
            }
            // attempt to find agent
            else {
                const lastLoc = Helper.findLastKnownLocation(currentTarget);
                await dumbNavigateStep(lastLoc ? lastLoc.id : 0);
            }
        }
    }
}

async function questHandler() {
    if (activeQuest === undefined) {
        talked.clear();
        exploredInfo.clear();
        questState = "evaluating";
        currentLeads = [];
        currentTarget = undefined;
        solution = undefined;
        activeQuest = ClientAPI.playerAgent.activeAssignedQuests[0];
        console.log("Starting Quest " + activeQuest);
    }
    else if (activeQuest.type === "question") {
        await questQuestionSolver();
    }
}

/**
 * Handles initial login process for agent
 */
function init() {
    ClientAPI.init();
    ClientAPI.login(username, password).then(res => {
        console.log("Login success! " + ClientAPI.playerAgent);
        main();
    }).catch(err => {
        throw new Error("Login fail!");
    });
}

init();