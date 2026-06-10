from apps.jobs.extraction import apple_health_snapshot


def test_snapshot_takes_most_recent_per_metric_not_average():
    events = [  # newest-first
        {"event_type": "apple_health_steps_avg_7d", "occurred_at": "2024-03-02", "data": {"steps": 9000}},
        {"event_type": "apple_health_steps_avg_7d", "occurred_at": "2024-03-01", "data": {"steps": 5000}},  # older -> ignored
        {"event_type": "apple_health_sleep_avg_7d", "occurred_at": "2024-03-02", "data": {"minutes": 430}},
        {"event_type": "apple_health_distance_avg_7d", "occurred_at": "2024-03-02", "data": {"miles": 3.2}},
        {"event_type": "apple_health_active_energy_avg_7d", "occurred_at": "2024-03-02", "data": {"kcal": 520}},
        {"event_type": "apple_health_heart_rate_recent", "occurred_at": "2024-03-02", "data": {"bpm": 62}},
        {"event_type": "apple_health_hrv_recent", "occurred_at": "2024-03-02", "data": {"ms": 45.5}},
        {"event_type": "apple_health_weight_recent", "occurred_at": "2024-03-02", "data": {"weight_lb": 180.4}},
        {"event_type": "apple_health_blood_pressure_recent", "occurred_at": "2024-03-02", "data": {"systolic": 118, "diastolic": 76}},
    ]
    s = apple_health_snapshot(events)
    assert s["steps_per_day_7d_avg"] == 9000          # most-recent, NOT averaged with 5000
    assert s["sleep_min_per_night_7d_avg"] == 430
    assert s["distance_mi_per_day_7d_avg"] == 3.2     # was dropped before
    assert s["active_energy_kcal_per_day_7d_avg"] == 520  # was dropped before
    assert s["heart_rate_bpm_latest"] == 62
    assert s["hrv_ms_latest"] == 45.5
    assert s["weight_lb_latest"] == 180.4
    assert s["blood_pressure_latest"] == {"systolic": 118, "diastolic": 76}


def test_snapshot_absent_metrics_are_none():
    s = apple_health_snapshot([{"event_type": "apple_health_steps_avg_7d", "occurred_at": "2024-03-02", "data": {"steps": 7000}}])
    assert s["steps_per_day_7d_avg"] == 7000
    assert s["hrv_ms_latest"] is None
    assert s["weight_lb_latest"] is None
    assert s["blood_pressure_latest"] is None


def test_snapshot_empty():
    s = apple_health_snapshot([])
    assert all(v is None for v in s.values())
