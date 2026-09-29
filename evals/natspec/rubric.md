# Eval rubric · natspec

The skill under test is `.claude/skills/natspec/`. It carries CODE-NAT-01 and CODE-NAT-02 (Code Rules · NatSpec).

Each case gives one Solidity function with no NatSpec and asks for its NatSpec. The judge reads the case's "What a correct answer says" and scores the answer on the five criteria below. Each criterion earns 0, 1 or 2 points. The case score is the sum of the points divided by 10.

| Criterion | 2 points | 1 point | 0 points |
| -- | -- | -- | -- |
| `tags` | `@notice`, one `@param` per named parameter, one `@return` per returned value (CODE-NAT-01) | One tag missing | Two or more tags missing, or no NatSpec |
| `units` | Every `@param` and `@return` names the unit the case expects (CODE-NAT-02) | One value's unit missing or vague | Two or more units missing or wrong |
| `rounding` | States the rounding the case expects, on the value it applies to, and claims no rounding the code doesn't do (CODE-NAT-02) | Rounding stated, but not on the value it applies to | Rounding missing where the case expects it, the wrong direction, or rounding claimed where there is none |
| `true_to_code` | Nothing in the NatSpec contradicts the code | One small inaccuracy that touches no unit and no rounding | A wrong unit, a wrong direction, or behaviour the code doesn't have |
| `code_unchanged` | The function's signature and body are the case's, spacing aside | Only comments inside the body changed | The signature or the body changed, or the function is missing |

Threshold: 0.8

The eval passes when, on each model under test, the mean of the six case scores is at or above the threshold (TEST E-NS).
