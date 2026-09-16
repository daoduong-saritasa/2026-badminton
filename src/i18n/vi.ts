/**
 * The interface's Vietnamese copy. Parameterized entries are functions rather
 * than fragments joined in a component, so word order stays inside this file.
 *
 * Terminology follows CONTEXT.md. The register is impersonal throughout: state
 * the action or its consequence, never address the reader.
 */
import { formatNumber } from './format'

export const messages = {
  common: {
    cancel: 'Huỷ',
    confirm: 'Xác nhận',
    close: 'Đóng',
    saving: 'Đang lưu…',
    checking: 'Đang kiểm tra…',
    toBeDecided: 'Chưa xác định',
    versus: (a: string, b: string) => `${a} gặp ${b}`,
    awaitingQualifier: 'Chờ cặp thắng',
    unknownPair: 'Cặp không xác định',
    unknownPlayers: 'Không rõ người chơi',
    unknownMatch: 'Trận không xác định',
    court: (court: number) => `Sân ${formatNumber(court)}`,
    group: (group: string) => `Bảng ${group}`,
    seeds: (first: number, second: number) =>
      `Hạt giống ${formatNumber(first)} + ${formatNumber(second)}`,
    seedsUnavailable: 'Chưa có hạt giống',
  },

  rounds: {
    group: 'Vòng bảng',
    semifinal: 'Bán kết',
    final: 'Chung kết',
  },

  matchState: {
    unstarted: 'Chưa bắt đầu',
    playing: 'Đang thi đấu',
    completed: 'Đã kết thúc',
    void: 'Đã huỷ',
    walkover: 'Xử thắng',
    notPlayed: 'Chưa thi đấu',
  },

  ticket: {
    status: {
      playing: 'Đang đấu',
      completed: 'Đã xong',
      upNext: 'Sắp tới',
    },
    theFinal: 'Trận chung kết',
    upNext: 'Tiếp theo',
    order: (order: number) => `Thứ tự ${formatNumber(order)}`,
    courtLabel: (court: number) => `Sân ${formatNumber(court)}`,
    roundMatch: (round: string) => `Trận ${round.toLowerCase()}`,
    unknownPlayer: 'Không rõ tên',
  },

  bracket: {
    heading: 'Vòng loại trực tiếp',
    description: 'Hai cặp thắng bán kết gặp nhau ở chung kết.',
    awaitingStandings: 'Chờ xác nhận bảng xếp hạng',
    active: 'Đang thi đấu',
    semifinals: 'Bán kết',
    semifinalCount: (count: number) => `${formatNumber(count)} trận`,
    finalHeading: 'Chung kết',
    finalPairs: (count: number) => `${formatNumber(count)} cặp`,
    semifinalNumber: (index: number) => `Bán kết ${formatNumber(index)}`,
    courtPending: 'Chưa xếp sân',
    championLabel: 'Vô địch',
    championshipMatch: 'Trận tranh vô địch',
    winnerAdvances: 'Cặp thắng vào chung kết',
  },

  standings: {
    heading: 'Bảng xếp hạng',
    description: 'Hai cặp đứng đầu mỗi bảng vào vòng loại trực tiếp.',
    pair: 'Cặp',
    // Abbreviated to fit a 320px table; the full term is the accessible name.
    playedShort: 'Trận',
    played: 'Số trận đã đấu',
    winsShort: 'Thắng',
    wins: 'Số trận thắng',
    differenceShort: '±',
    difference: 'Hiệu số điểm',
  },

  results: {
    heading: 'Kết quả',
    description:
      'Ghi kết quả cho trận đã đấu mà không ghi điểm trực tiếp, hoặc sửa kết quả đã ghi.',
    upcoming: 'Sắp đấu',
    completed: 'Đã kết thúc',
    noUpcoming: 'Chưa có trận nào đủ hai cặp để ghi kết quả.',
    noCompleted: 'Chưa ghi kết quả nào.',
    enterResult: 'Ghi kết quả',
    correct: 'Sửa',
    matchGone: 'Trận đấu này không còn nữa.',
    correctionIntro: 'Đang sửa một kết quả đã ghi. Hãy xem lại ảnh hưởng trước khi xác nhận.',
    entryIntro: 'Ghi kết quả cho trận đã đấu mà không ghi điểm trực tiếp.',
    scoreHint: 'Tỉ số hợp lệ: thắng cách 2 điểm từ 21, tối đa 30.',
    reviewCorrection: 'Xem trước thay đổi',
    reviewResult: 'Xem trước kết quả',
    confirmCorrectionTitle: 'Sửa kết quả này?',
    confirmResultTitle: 'Ghi kết quả này?',
    reviewBeforeConfirm: 'Xem lại những thay đổi trước khi xác nhận.',
    cannotApply: 'Không thể thực hiện thay đổi này.',
    confirmChange: 'Xác nhận thay đổi',
    walkoverWinner: 'Cặp được xử thắng',
    recordWalkover: 'Xử thắng',
    confirmWalkoverTitle: 'Xử thắng trận này?',
    walkoverConsequence: (pair: string) =>
      `${pair} thắng mà không thi đấu. Các kết quả trước đó giữ nguyên.`,
    confirmWalkover: 'Xác nhận xử thắng',
  },

  withdrawals: {
    heading: 'Rút lui',
    description:
      'Rút lui sẽ huỷ các trận vòng bảng của cặp đó và tính lại bảng xếp hạng. Hãy xem lại ảnh hưởng trước khi xác nhận.',
    review: 'Xem trước',
    withdrawn: (names: string) => `Đã rút lui: ${names}`,
    confirmTitle: (pair: string) => `Cho ${pair} rút lui?`,
    confirmTitleFallback: 'Cho cặp này rút lui?',
    consequence: 'Các trận vòng bảng của cặp này sẽ bị huỷ và bảng xếp hạng được tính lại.',
    cannotApply: 'Không thể cho cặp này rút lui.',
    confirm: 'Xác nhận rút lui',
  },

  impact: {
    blockedHeading: 'Không thể thực hiện thay đổi này',
    score: 'Tỉ số',
    affectedMatches: (count: number) => `Trận bị ảnh hưởng (${formatNumber(count)})`,
    confirmationsLost: (groups: string) => `${groups} cần được xác nhận lại.`,
    blocked: {
      'knockouts-started':
        'Vòng loại trực tiếp đã bắt đầu nên không sửa được kết quả vòng bảng, kể cả khi cặp thắng không đổi. Hãy xử thắng cho trận bị ảnh hưởng.',
      'final-started': 'Trận chung kết đã phụ thuộc vào trận bán kết này nên không đổi được cặp thắng.',
      'too-few-active-pairs':
        'Mỗi bảng phải còn ít nhất hai cặp thi đấu. Hãy xử thắng cho những trận cặp này không đấu được, thay vì cho rút lui.',
      'invalid-match-state':
        'Trạng thái trận đấu không cho phép ghi kết quả này. Trận đang ghi điểm trực tiếp cần được kết thúc trước.',
      'tournament-completed': 'Giải đấu đã kết thúc. Hãy mở lại giải trước khi sửa kết quả.',
    },
  },
} as const
