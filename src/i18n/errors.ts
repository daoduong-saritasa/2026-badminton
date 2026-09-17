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
  'Roster requires four teams, two per group, and sixteen players':
    'Cần bốn đội, mỗi bảng hai đội, tổng cộng mười sáu người chơi.',
  'Each team requires two seed 1 and two seed 2 players': 'Mỗi đội cần hai hạt giống 1 và hai hạt giống 2.',
  'Invalid player': 'Có người chơi không hợp lệ.',
  'Roster is locked after group play starts': 'Không thể sửa danh sách đội sau khi vòng bảng bắt đầu.',

  // Lineups and group play
  'Lineup cannot be changed': 'Không thể sửa đội hình này. Cuộc đối đầu đã bắt đầu hoặc cả hai đội đã xác nhận.',
  'Lineup players must belong to the team and match their seeds':
    'Người chơi phải thuộc đội này và đúng hạt giống của vị trí.',
  'Decider pair must differ from both opening pairs': 'Cặp trận 3 phải khác cặp trận 1 và trận 2.',
  'Opening pairs must use all four players exactly once': 'Trận 1 và trận 2 phải dùng đủ bốn người chơi, mỗi người một lần.',
  'A complete lineup is required': 'Cần lưu đủ đội hình ba trận trước khi xác nhận.',
  'Lineups are locked after a fixture starts': 'Không thể mở lại đội hình sau khi cuộc đối đầu đã bắt đầu.',
  'Both lineups must be confirmed': 'Cả hai đội cần xác nhận đội hình.',
  'Fixture participants are not assigned': 'Cuộc đối đầu chưa xác định đủ hai đội.',
  'Valid rosters and four confirmed lineups are required':
    'Cần đủ bốn đội hợp lệ và bốn đội hình vòng bảng đã xác nhận.',

  // Courts and match start
  'Invalid court assignments': 'Xếp sân không hợp lệ.',
  'Court must be 1 or 2': 'Chỉ có sân 1 và sân 2.',
  'Only unstarted matches can be assigned': 'Chỉ xếp được sân cho trận chưa bắt đầu.',
  'Match is not ready to start': 'Trận đấu chưa sẵn sàng: cần xếp sân và hai đội hình đã xác nhận.',
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
  'A corrected result requires two or three games and one winner': 'Kết quả sửa cần hai hoặc ba ván và một cặp thắng.',
  'Corrected games contain an invalid score or an extra game': 'Có ván không hợp lệ hoặc ván thừa sau khi trận đã phân định.',
  'Corrected winner does not match the games': 'Cặp thắng không khớp với tỉ số các ván.',
  'decider-started': 'Trận quyết định đã bắt đầu nên không thể sửa kết quả làm cho trận này không còn cần thiết.',
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
