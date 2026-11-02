import math
import unittest

import match_predictor as predictor


class GoalCalibrationTests(unittest.TestCase):
    def test_zero_scoring_average_is_preserved(self):
        home = predictor.profile({
            "fixtures": {"played": {"home": 4, "away": 0}},
            "goals": {"for": {"average": {"home": "0.0"}},
                      "against": {"average": {"home": "1.0"}}},
        }, "home")
        away = predictor.profile({
            "fixtures": {"played": {"home": 0, "away": 4}},
            "goals": {"for": {"average": {"away": "1.0"}},
                      "against": {"average": {"away": "0.0"}}},
        }, "away")
        self.assertTrue(home["gf_side_valid"])
        self.assertAlmostEqual(predictor.calibrated_goal_lambdas(home, away)[0], 0.795)

        result = predictor.predict_all(
            home, away, {},
            {"odd_o25": 1.85, "odd_u25": 2.0, "odd_o35": 3.1},
            "Home", "Away",
        )
        self.assertEqual(result["goal_model_version"], "PB-GOALS-2026-11-02")
        self.assertAlmostEqual(result["lam_home"], 0.795)
        self.assertTrue(0 <= result["p_over35"] <= result["p_over25"] <= 1)

    def test_market_blend_has_finite_fallback_without_price(self):
        for market in ("O25", "O35"):
            probability = predictor.calibrated_goal_probability(market, 0.42, None)
            self.assertTrue(math.isfinite(probability))
            self.assertAlmostEqual(probability, 0.42)


if __name__ == "__main__":
    unittest.main()
