import {
  BehaviorState,
  SuccessAction,
  ActionState,
  FailureAction
} from "../../../lib";
import { Room, ClientAPI } from "panoptyk-engine/dist/client";
import { MoveAction } from "../Actions/moveAction";
import roomMap from "../../../lib/KnowledgeBase/RoomMap";

export class MoveBehavior extends BehaviorState {
  public static destination: Room;
  public static path: Room[];
  public static pathPos = 0;

  constructor(nextState: () => BehaviorState) {
    super(nextState);
    this.currentActionState = new MoveAction(
      MoveBehavior.moveActionTransition,
      MoveBehavior.path[MoveBehavior.pathPos]
    );
  }

  public static assignNewDestinationRoom(newDest: Room): boolean {
    MoveBehavior.destination = newDest;
    MoveBehavior.path = roomMap.findPath(
      ClientAPI.playerAgent.room,
      MoveBehavior.destination
    );
    MoveBehavior.pathPos = 0;
    if (MoveBehavior.path === undefined || !(MoveBehavior.path.length > 0)) {
      return false;
    }
    return true;
  }

  public static moveActionTransition(this: MoveAction): ActionState {
    if (
      this.isMoveCompleted &&
      this.moveDestination === MoveBehavior.destination
    ) {
      return SuccessAction.instance;
    } else if (this.isMoveCompleted) {
      MoveBehavior.pathPos++;
      if (MoveBehavior.pathPos > MoveBehavior.path.length) {
        return FailureAction.instance;
      }
      return new MoveAction(
        MoveBehavior.moveActionTransition,
        MoveBehavior.path[MoveBehavior.pathPos]
      );
    }
    return this;
  }

  public nextState(): BehaviorState {
    return undefined;
  }
}