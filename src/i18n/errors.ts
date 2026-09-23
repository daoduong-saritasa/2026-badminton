/**
 * Known server failures, keyed by the exact message PostgreSQL raises.
 *
 * Anything absent from this table is treated as unknown: the raw text is a
 * developer-facing English string that may also carry identifiers, so it is
 * logged rather than shown. Messages state what to do next where there is
 * something to do, because most of these are reachable by two organizers
 * working at once rather than by a mistake.
 */
const serverMessages: Record<string, string> = {
  // Concurrency and staleness
  'Tournament version conflict': 'Giải đấu vừa thay đổi. Hãy tải lại và thử lại.',
  'Fixture version conflict': 'Cuộc đối đầu vừa thay đổi. Hãy tải lại và thử lại.',
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
  'Player already plays in this fixture': 'Có người đã được xếp ở trận còn lại của cuộc đối đầu.',
  'Fixture participants are not assigned': 'Cuộc đối đầu chưa xác định đủ hai đội.',
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
  'A player is already playing': 'Có người chơi đang thi đấu ở trận khác.',
  'Decider is not eligible': 'Trận 3 chỉ diễn ra khi hai trận đầu đã có kết quả 1–1.',

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
  'Unknown tournament mutation': 'Thao tác không được hỗ trợ.',
}

/**
 * Client-side failures, keyed by `Error.name`. Their messages interpolate
 * versions and issue lists, so they cannot be matched by text.
 */
const clientMessages: Record<string, string> = {
  InvalidTournamentDataError: 'Dữ liệu nhận được không hợp lệ. Hãy tải lại trang.',
  StaleTournamentSnapshotError: 'Dữ liệu đang cũ hơn thay đổi vừa lưu. Hãy tải lại trang.',
}

const fallback = 'Đã xảy ra lỗi. Hãy thử lại, hoặc tải lại trang nếu vẫn lỗi.'

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
    const byName = clientMessages[error.name]
    if (byName !== undefined) return byName
  }

  const raw = rawMessage(error)
  if (raw === null) {
    console.error('Unknown failure with no message', { error })
    return fallback
  }

  const known = serverMessages[raw.trim()]
  if (known !== undefined) return known

  console.error('Untranslated failure', { message: raw })
  return fallback
}

export const unknownErrorMessage = fallback
