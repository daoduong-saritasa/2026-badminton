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
  'Match version conflict': 'Trận đấu vừa thay đổi. Hãy tải lại và thử lại.',
  'Tournament reset generation conflict': 'Giải đấu đã được đặt lại. Hãy tải lại trang.',
  'Completed match changed after this request': 'Trận đấu đã thay đổi sau yêu cầu này. Hãy xem lại kết quả mới.',
  'Tournament changed since the preview': 'Giải đấu đã thay đổi sau khi xem trước. Hãy xem lại rồi xác nhận.',
  'A reviewed preview is required for this change': 'Cần xem trước thay đổi này trước khi xác nhận.',
  'Request ID was already used with different input': 'Yêu cầu này đã được gửi với nội dung khác. Hãy tải lại và thử lại.',

  // Setup
  'Tournament is not configured': 'Chưa có giải đấu nào được thiết lập.',
  'Invalid setup payload': 'Thông tin thiết lập không hợp lệ.',
  'Invalid pair in setup': 'Có đội không hợp lệ trong thiết lập.',
  'Setup requires 4 to 10 pairs split evenly between groups':
    'Cần 4 đến 10 đội, chia đều cho hai bảng.',
  'Setup requires groups sized 3+3, 4+3, or 4+4': 'Hai bảng phải có 3+3, 4+3 hoặc 4+4 đội.',
  'Setup is locked after play starts': 'Không thể sửa thiết lập sau khi giải đã bắt đầu.',
  'A player can belong to only one pair': 'Mỗi người chỉ thuộc một đội.',
  'Court count must be one or two': 'Chỉ có thể chọn một hoặc hai sân.',
  'Select one or two courts before generating fixtures': 'Hãy chọn số sân trước khi tạo lịch thi đấu.',

  // Fixtures and courts
  'Fixtures already exist or setup is locked': 'Lịch thi đấu đã được tạo.',
  'Assignments must be an array': 'Phân sân không hợp lệ.',
  'Invalid court assignment': 'Phân sân không hợp lệ.',
  'Only unstarted matches can be assigned': 'Chỉ xếp được sân cho trận chưa bắt đầu.',
  'Court 2 has an active match': 'Sân 2 đang có trận. Hãy kết thúc trận đó trước khi bỏ sân.',
  'Court or pair is already playing': 'Sân hoặc đội này đang thi đấu.',

  // Scoring
  'Match is not ready to start': 'Trận đấu chưa sẵn sàng để bắt đầu.',
  'Only a playing match can be taken over': 'Chỉ nhận quyền ghi điểm được với trận đang diễn ra.',
  'Only a playing match can be undone': 'Chỉ hoàn tác được với trận đang diễn ra.',
  'Current session does not own this match': 'Thiết bị khác đang ghi điểm trận này.',
  'Point cannot be added': 'Không thể ghi thêm điểm cho trận này.',
  'No point is available to undo': 'Không còn điểm nào để hoàn tác.',
  'Score history is inconsistent': 'Lịch sử điểm không khớp. Hãy tải lại trang.',
  'Match has no winning score to confirm': 'Tỉ số chưa đủ để kết thúc trận.',

  // Results
  'Match not found': 'Không tìm thấy trận đấu.',
  'Match state does not allow this result': 'Trạng thái trận đấu không cho phép ghi kết quả này.',
  'Invalid completed score': 'Tỉ số không hợp lệ. Thắng cách 2 điểm từ 21, tối đa 30.',
  'Walkover winner must be a participant': 'Đội được xử thắng phải là một trong hai đội thi đấu.',
  'Knockout play already depends on group participants':
    'Vòng loại trực tiếp đã bắt đầu nên không sửa được kết quả vòng bảng, kể cả khi đội thắng không đổi.',
  'Final play already depends on this semifinal':
    'Trận chung kết đã phụ thuộc vào trận bán kết này nên không đổi được đội thắng.',

  // Withdrawals and ties
  'Active pair not found': 'Không tìm thấy đội đang thi đấu.',
  'Pair cannot withdraw after knockout play starts':
    'Không thể rút lui sau khi vòng loại trực tiếp bắt đầu. Hãy xử thắng cho trận đội này không thi đấu được.',
  'Each group must retain at least two active pairs':
    'Mỗi bảng phải còn ít nhất hai đội thi đấu.',
  'All active group matches must be completed': 'Cần hoàn tất các trận vòng bảng trước.',
  'All active group matches must be completed before resolving a tie':
    'Cần hoàn tất các trận vòng bảng trước khi xử lý đồng hạng.',
  'Ties can only be resolved during the group stage': 'Chỉ xử lý đồng hạng trong vòng bảng.',
  'Invalid tie resolution': 'Thứ tự xử lý đồng hạng không hợp lệ.',
  'Tie order must contain exactly the unresolved group pairs':
    'Thứ tự phải gồm đúng các đội đang đồng hạng.',
  'Residual ties require an exact recorded order': 'Cần ghi rõ thứ tự cho các đội còn đồng hạng.',
  'Only a completed tournament can be reopened': 'Chỉ mở lại được giải đã kết thúc.',

  // Staff access
  'Authenticated session required': 'Phiên đăng nhập đã hết hạn. Hãy tải lại trang.',
  'Verified session identity required': 'Phiên đăng nhập đã hết hạn. Hãy tải lại trang.',
  'Staff authentication required': 'Cần quyền điều hành.',
  'Staff access expired or revoked': 'Quyền điều hành đã hết hạn. Hãy nhập lại mã PIN.',
  'PIN must contain 4 to 12 digits': 'Mã PIN phải có 4 đến 12 chữ số.',
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
