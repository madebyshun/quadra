/**
 * Real answers from FxTwitter's public API, captured 2026-10-21, unedited. To re-measure:
 *
 *   F=https://api.fxtwitter.com
 *   curl -s $F/madebyshun > user-madebyshun.json     # the owner's own profile
 *   curl -s $F/jessepollak > user-jessepollak.json   # a second real profile, 356K followers
 *   curl -s $F/dril > user-dril.json                 # a bio that is a swear and three links
 *   curl -s $F/a > notfound-a.json                   # 404 {"message":"User not found"}
 *   curl -s $F/elonjet > suspended-elonjet.json      # 404 {"reason":"suspended"}
 *   curl -s -o avatar-madebyshun.jpg "<madebyshun's avatar_url with _normal → _400x400>"
 *                                                    # image/jpeg, access-control-allow-origin: *
 *
 * Also MEASURED, not captured: every answer above carries `access-control-allow-origin: *`; a path
 * that is not a handle (`thishandleisnotreal9`, 20 characters; `bad-handle`) answers a 302 to
 * github.com/FxEmbed; and `jack` answered "User not found" once and his profile a second later — so
 * a 404 is what FxTwitter said, not a fact about X.
 */
import userMadebyshun from "./user-madebyshun.json";
import userJessepollak from "./user-jessepollak.json";
import userDril from "./user-dril.json";
import notfoundA from "./notfound-a.json";
import suspendedElonjet from "./suspended-elonjet.json";

export const XF = { userMadebyshun, userJessepollak, userDril, notfoundA, suspendedElonjet };
