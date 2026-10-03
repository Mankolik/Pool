// Rules referee for solo racks: judges a finished shot (fouls, penalties, respots, bonuses, rack clear).
// The score of a rack is shots + penalty strokes − bonuses, compared with its par.
(function () {
  const Pool = globalThis.Pool;

  // before: ball numbers on the table before the shot (object balls only).
  // shot: { first, pocketed: [{ n, pocket }], scratch }.
  function judge(rack, before, shot) {
    const out = { foul: null, penalty: 0, respot: [], cleared: false, bonus: 0, potted: [], messages: [], cueInHand: false };
    const pottedNums = shot.pocketed.filter((p) => p.n !== 0).map((p) => p.n);
    out.potted = pottedNums;
    const lowest = before.length ? Math.min(...before) : null;
    // Fouls.
    if (shot.first == null) {
      out.foul = 'miss';
      out.messages.push('Foul: no ball hit (+1)');
    } else if (rack.order === 'lowest' && shot.first !== lowest) {
      out.foul = 'wrong';
      out.messages.push(`Foul: hit the ${shot.first} before the ${lowest} (+1)`);
    }
    if (shot.scratch) {
      out.foul = out.foul || 'scratch';
      out.cueInHand = true;
      out.messages.push('Scratch! Ball in hand (+1)');
    }
    if (out.foul) out.penalty += 1;
    const left = before.filter((n) => !pottedNums.includes(n));
    // Eight-ball: the 8 goes last.  Sunk early, it comes back and costs two.
    if (rack.lastBall != null && pottedNums.includes(rack.lastBall) && left.length > 0) {
      out.respot.push(rack.lastBall);
      out.penalty += 2;
      out.messages.push(`The ${rack.lastBall} went down early — respotted (+2)`);
    }
    // Nine-ball: a legal 9 wins the rack; on a foul it's respotted.
    let early = false;
    if (rack.moneyBall != null && pottedNums.includes(rack.moneyBall)) {
      if (out.foul) {
        if (left.length > 0) {
          out.respot.push(rack.moneyBall);
          out.messages.push(`The ${rack.moneyBall} is respotted after the foul`);
        }
      } else if (left.length > 0) {
        early = true;
        out.messages.push(`The ${rack.moneyBall} on a legal shot — rack cleared!`);
      }
    }
    // Casino: a ball in the lucky pocket on a clean shot is worth a shot back.
    if (rack.table.lucky >= 0 && !out.foul && shot.pocketed.some((p) => p.n !== 0 && p.pocket === rack.table.lucky)) {
      out.bonus = 1;
      out.messages.push('★ Lucky pocket! −1');
    }
    const remaining = left.length + out.respot.length;
    out.cleared = early || remaining === 0;
    out.early = early;
    return out;
  }

  // Score names, golf style.
  function scoreName(score, par) {
    const d = score - par;
    if (d <= -4) return 'Clinic!';
    return { '-3': 'Albatross!', '-2': 'Eagle!', '-1': 'Birdie!', 0: 'Par', 1: 'Bogey', 2: 'Double bogey', 3: 'Triple bogey' }[d] || `+${d}`;
  }

  // Shot cap per rack: the rack ends (scored at the cap) if you get there.
  const capFor = (par) => par * 2 + 2;

  Pool.rules = { judge, scoreName, capFor };
})();
