import { currentLocale, type Locale } from './locale'

/**
 * Known server failures in Vietnamese, keyed by the exact message PostgreSQL
 * raises; the English table below has the same keys.
 *
 * Anything absent from this table is treated as unknown: the raw text is a
 * developer-facing English string that may also carry identifiers, so it is
 * logged rather than shown. Messages state what to do next where there is
 * something to do, because most of these are reachable by two organizers
 * working at once rather than by a mistake.
 */
const viServerMessages = {
  // Concurrency and staleness
  'Tournament version conflict': 'Giải đấu vừa thay đổi. Hãy tải lại và thử lại.',
  'Fixture version conflict': 'Cặp đấu vừa thay đổi. Hãy tải lại và thử lại.',
  'Match version conflict': 'Trận đấu vừa thay đổi. Hãy tải lại và thử lại.',
  'Tournament reset generation conflict': 'Giải đấu đã được đặt lại. Hãy tải lại trang.',
  'Reviewed result impact is stale': 'Kết quả đã thay đổi sau khi xem trước. Hãy xem lại rồi xác nhận.',
  'Request ID was already used with different input': 'Yêu cầu này đã được gửi với nội dung khác. Hãy tải lại và thử lại.',

  // Roster
  'Tournament is not configured': 'Chưa có giải đấu nào được thiết lập.',
  'Invalid roster payload': 'Thông tin danh sách đội không hợp lệ.',
  'Roster requires four teams and sixteen players': 'Cần bốn đội, tổng cộng mười sáu người chơi.',
  'Each team requires two seed 1 and two seed 2 players': 'Mỗi đội cần hai hạt giống 1 và hai hạt giống 2.',
  'Invalid player': 'Có người chơi không hợp lệ.',
  'Roster is locked after qualifying starts': 'Không thể sửa danh sách đội sau khi vòng loại bắt đầu.',

  // Pair assignment and qualifying
  'Invalid pair assignment': 'Thông tin xếp cặp không hợp lệ.',
  'Pairs are fixed after the match starts': 'Trận đã bắt đầu nên cặp không đổi được.',
  'Pair assignment is not open for this match':
    'Chưa xếp cặp được cho trận này. Trận tranh hạng chỉ mở sau khi đội vào chung kết được xác nhận.',
  'A pair requires two distinct players': 'Một cặp phải gồm hai người khác nhau.',
  'Pair players must belong to the team': 'Người chơi phải thuộc đội này.',
  'Pair must mix seeds': 'Trận này cần một hạt giống 1 và một hạt giống 2.',
  'Player already plays in this fixture': 'Có người đã được xếp ở trận còn lại của cặp đấu.',
  'Fixture participants are not assigned': 'Cặp đấu chưa xác định đủ hai đội.',
  'Qualifying requires four complete teams': 'Cần đủ bốn đội, mỗi đội bốn người, trước khi bắt đầu vòng loại.',

  // Qualification
  'Finalists are not resolved': 'Chưa xác định được đội vào chung kết.',
  'Finalists must be confirmed before placement play': 'Cần xác nhận đội vào chung kết trước khi đấu tranh hạng.',
  'Third place must finish before the final starts': 'Tranh hạng ba phải kết thúc trước khi chung kết bắt đầu.',
  'A four-team draw requires two complete matchups': 'Bốc thăm bốn đội cần đủ hai cặp đấu.',
  'Qualification-playoff matchups do not match the unresolved tie':
    'Các cặp đấu không khớp với nhóm đội đang bằng nhau.',
  'Draws are locked after placement play starts': 'Không thể đổi kết quả bốc thăm sau khi tranh hạng bắt đầu.',

  // Courts and match start
  'Invalid court assignments': 'Xếp sân không hợp lệ.',
  'Court must be 1 or 2': 'Chỉ có sân 1 và sân 2.',
  'Only unstarted matches can be assigned': 'Chỉ xếp được sân cho trận chưa bắt đầu.',
  'Match is not ready to start': 'Trận đấu chưa sẵn sàng: cần xếp sân và cặp của cả hai đội.',
  'Court is occupied': 'Sân này đang có trận khác thi đấu.',
  'Court names must be two distinct names of 1 to 30 characters': 'Hai sân phải có tên khác nhau, mỗi tên 1–30 ký tự.',
  'A player is already playing': 'Có người chơi đang thi đấu ở trận khác.',
  'Decider is not eligible': 'Trận 3 chỉ diễn ra khi hai trận đầu đã có kết quả 1–1.',

  'Earlier qualifying rounds must finish': 'Cần kết thúc các lượt trước.',
  'First qualifying match must finish': 'Cần kết thúc trận 1 của cặp đấu.',
  'Qualifying courts are locked after progress': 'Lượt đã bắt đầu nên không thể đổi sân.',
  'Qualifying schedule is invalid': 'Lịch vòng loại không hợp lệ. Liên hệ điều hành.',

  // Scoring
  'Only a playing match can be taken over': 'Chỉ nhận quyền ghi điểm được với trận đang diễn ra.',
  'Session already owns this match': 'Thiết bị này đang giữ quyền ghi điểm trận này.',
  'This session does not own the match': 'Thiết bị khác đang ghi điểm trận này.',
  'Point cannot be added': 'Không thể ghi thêm điểm cho trận này.',
  'Point cannot be undone': 'Không thể hoàn tác điểm của trận này.',
  'Game is already won': 'Ván đã đủ điểm thắng. Hãy kết thúc ván hoặc hoàn tác.',
  'No point is available to undo': 'Không còn điểm nào để hoàn tác trong ván này.',
  'Point history does not match the open game': 'Lịch sử điểm không khớp với ván đang đấu. Hãy tải lại trang.',
  'Game cannot be confirmed': 'Không thể kết thúc ván của trận này.',
  'Game does not have a valid winning score': 'Tỉ số chưa đủ để kết thúc ván.',

  // Results
  'Walkover requires an unscored match and one winner': 'Chỉ xử thắng được trận chưa ghi điểm nào.',
  'Corrected result has the wrong number of games':
    'Số ván không đúng: trận tranh hạng ba và chung kết cần hai hoặc ba ván, các trận khác một ván.',
  'Corrected games contain an invalid score or an extra game': 'Có ván không hợp lệ hoặc ván thừa sau khi trận đã phân định.',
  'Corrected winner does not match the games': 'Cặp thắng không khớp với tỉ số các ván.',
  'playoff-started': 'Trận tranh vé đã bắt đầu nên không thể sửa kết quả làm thay đổi trận tranh vé.',
  'placement-started': 'Trận tranh hạng đã bắt đầu nên không thể sửa kết quả làm thay đổi đội đi tiếp.',
  'tournament-completed': 'Giải đấu đã kết thúc nên không sửa được kết quả.',
  'invalid-match-state': 'Chỉ sửa được kết quả của trận đã kết thúc.',

  // Staff access
  'Authenticated session required': 'Phiên đăng nhập đã hết hạn. Hãy tải lại trang.',
  'Verified session identity required': 'Phiên đăng nhập đã hết hạn. Hãy tải lại trang.',
  'Staff authentication required': 'Cần quyền điều hành hoặc trọng tài.',
  'Organizer access required': 'Cần quyền điều hành.',
  'Scoring access required': 'Cần quyền trọng tài hoặc điều hành.',
  'Staff access expired or revoked': 'Quyền truy cập đã hết hạn. Hãy nhập lại mã PIN.',
  'PIN must contain 4 to 12 digits': 'Mã PIN phải có 4 đến 12 chữ số.',
  'Staff role PINs must differ': 'Mã PIN điều hành và trọng tài phải khác nhau.',
  'Unknown staff role': 'Vai trò không hợp lệ.',
  'Invalid rate-limit bucket': 'Yêu cầu không hợp lệ.',
  'Service role required': 'Thao tác này chỉ chạy được từ công cụ quản trị.',
  'The staff PIN is incorrect': 'Mã PIN không đúng.',
  'Enter a PIN containing 4 to 12 digits': 'Mã PIN phải có 4 đến 12 chữ số.',
  'The staff PIN could not be rotated': 'Chưa đổi được mã PIN. Hãy thử lại.',
  'Staff access is unavailable': 'Chưa đăng nhập được. Hãy thử lại sau.',
  'Unknown tournament mutation': 'Thao tác không được hỗ trợ.',
} satisfies Record<string, string>

type ServerFailure = keyof typeof viServerMessages

const enServerMessages: Record<ServerFailure, string> = {
  'Tournament version conflict': 'The tournament just changed. Reload and try again.',
  'Fixture version conflict': 'The fixture just changed. Reload and try again.',
  'Match version conflict': 'The match just changed. Reload and try again.',
  'Tournament reset generation conflict': 'The tournament was reset. Reload the page.',
  'Reviewed result impact is stale': 'Results changed after your review. Review again, then confirm.',
  'Request ID was already used with different input': 'This request was already sent with different content. Reload and try again.',

  'Tournament is not configured': 'No tournament has been set up yet.',
  'Invalid roster payload': 'The team list is not valid.',
  'Roster requires four teams and sixteen players': 'Four teams with sixteen players in all are required.',
  'Each team requires two seed 1 and two seed 2 players': 'Each team needs two seed 1 and two seed 2 players.',
  'Invalid player': 'A player is not valid.',
  'Roster is locked after qualifying starts': 'The team list cannot change after qualifying starts.',

  'Invalid pair assignment': 'The pair assignment is not valid.',
  'Pairs are fixed after the match starts': 'The match has started, so the pairs cannot change.',
  'Pair assignment is not open for this match':
    'Pairs cannot be assigned for this match yet. Placement fixtures open only after the finalists are confirmed.',
  'A pair requires two distinct players': 'A pair needs two different players.',
  'Pair players must belong to the team': 'Players must belong to this team.',
  'Pair must mix seeds': 'This match needs one seed 1 and one seed 2 player.',
  'Player already plays in this fixture': 'A player is already in the other match of this fixture.',
  'Fixture participants are not assigned': 'Both teams of this fixture are not decided yet.',
  'Qualifying requires four complete teams': 'Four teams of four players are required before qualifying starts.',

  'Finalists are not resolved': 'The finalists are not decided yet.',
  'Finalists must be confirmed before placement play': 'Confirm the finalists before placement fixtures are played.',
  'Third place must finish before the final starts': 'The third-place fixture must end before the final starts.',
  'A four-team draw requires two complete matchups': 'A four-team draw needs two complete fixtures.',
  'Qualification-playoff matchups do not match the unresolved tie':
    'The fixtures do not match the teams that are still level.',
  'Draws are locked after placement play starts': 'The draw cannot change after placement fixtures start.',

  'Invalid court assignments': 'The court assignment is not valid.',
  'Court must be 1 or 2': 'Only court 1 and court 2 exist.',
  'Only unstarted matches can be assigned': 'Only a match that has not started can change court.',
  'Match is not ready to start': 'The match is not ready: it needs a court and both pairs.',
  'Court is occupied': 'Another match is in play on this court.',
  'Court names must be two distinct names of 1 to 30 characters': 'The two courts need different names of 1–30 characters.',
  'A player is already playing': 'A player is in play in another match.',
  'Decider is not eligible': 'Match 3 is played only when the first two matches end 1–1.',

  'Earlier qualifying rounds must finish': 'Earlier rounds must finish first.',
  'First qualifying match must finish': 'Match 1 of this fixture must finish first.',
  'Qualifying courts are locked after progress': 'This round has started, so its courts cannot change.',
  'Qualifying schedule is invalid': 'The qualifying schedule is invalid. Contact the organizer.',

  'Only a playing match can be taken over': 'You can take over scoring only for a match in play.',
  'Session already owns this match': 'This device already scores this match.',
  'This session does not own the match': 'Another device is scoring this match.',
  'Point cannot be added': 'No more points can be added to this match.',
  'Point cannot be undone': 'Points in this match cannot be undone.',
  'Game is already won': 'The game already has a winning score. End the game or undo.',
  'No point is available to undo': 'This game has no point left to undo.',
  'Point history does not match the open game': 'The point history does not match the current game. Reload the page.',
  'Game cannot be confirmed': 'The game in this match cannot be ended.',
  'Game does not have a valid winning score': 'The score is not enough to end the game.',

  'Walkover requires an unscored match and one winner': 'A walkover is possible only for a match with no points.',
  'Corrected result has the wrong number of games':
    'Wrong number of games: third-place and final matches need two or three games, other matches one.',
  'Corrected games contain an invalid score or an extra game': 'A game is not valid, or a game follows a decided match.',
  'Corrected winner does not match the games': 'The winning pair does not match the game scores.',
  'playoff-started': 'A qualification playoff has started, so a correction that changes the playoff is not allowed.',
  'placement-started': 'A placement fixture has started, so a correction that changes who advances is not allowed.',
  'tournament-completed': 'The tournament has finished, so results cannot be corrected.',
  'invalid-match-state': 'Only a finished match can be corrected.',

  'Authenticated session required': 'Your session has expired. Reload the page.',
  'Verified session identity required': 'Your session has expired. Reload the page.',
  'Staff authentication required': 'Organizer or referee access is required.',
  'Organizer access required': 'Organizer access is required.',
  'Scoring access required': 'Referee or organizer access is required.',
  'Staff access expired or revoked': 'Your access has expired. Enter the PIN again.',
  'PIN must contain 4 to 12 digits': 'The PIN must have 4 to 12 digits.',
  'Staff role PINs must differ': 'The organizer and referee PINs must be different.',
  'Unknown staff role': 'The role is not valid.',
  'Invalid rate-limit bucket': 'The request is not valid.',
  'Service role required': 'This action runs only from the admin tools.',
  'The staff PIN is incorrect': 'The PIN is incorrect.',
  'Enter a PIN containing 4 to 12 digits': 'The PIN must have 4 to 12 digits.',
  'The staff PIN could not be rotated': 'The PIN was not changed. Try again.',
  'Staff access is unavailable': 'Sign-in is unavailable. Try again later.',
  'Unknown tournament mutation': 'This action is not supported.',
}

const serverMessages: Record<Locale, Record<string, string>> = {
  vi: viServerMessages,
  en: enServerMessages,
}

/**
 * Client-side failures, keyed by `Error.name`. Their messages interpolate
 * versions and issue lists, so they cannot be matched by text.
 */
const clientMessages: Record<Locale, Record<string, string>> = {
  vi: {
    InvalidTournamentDataError: 'Dữ liệu nhận được không hợp lệ. Hãy tải lại trang.',
    StaleTournamentSnapshotError: 'Dữ liệu đang cũ hơn thay đổi vừa lưu. Hãy tải lại trang.',
  },
  en: {
    InvalidTournamentDataError: 'The received data is not valid. Reload the page.',
    StaleTournamentSnapshotError: 'The data is older than the change just saved. Reload the page.',
  },
}

const fallbacks: Record<Locale, string> = {
  vi: 'Đã xảy ra lỗi. Hãy thử lại, hoặc tải lại trang nếu vẫn lỗi.',
  en: 'Something went wrong. Try again, or reload the page if it persists.',
}

function rawMessage(error: unknown): string | null {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const { message } = error as { message: unknown }
    if (typeof message === 'string') return message
  }
  return null
}

/**
 * Never returns raw server text: an unrecognized message is logged and replaced
 * with the fallback, so an identifier or an internal detail cannot reach the
 * screen.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const byName = clientMessages[currentLocale()][error.name]
    if (byName !== undefined) return byName
  }

  const raw = rawMessage(error)
  if (raw === null) {
    console.error('Unknown failure with no message', { error })
    return unknownErrorMessage()
  }

  const known = serverMessages[currentLocale()][raw.trim()]
  if (known !== undefined) return known

  console.error('Untranslated failure', { message: raw })
  return unknownErrorMessage()
}

/** The message shown for any failure without a translation. */
export function unknownErrorMessage(): string {
  return fallbacks[currentLocale()]
}
