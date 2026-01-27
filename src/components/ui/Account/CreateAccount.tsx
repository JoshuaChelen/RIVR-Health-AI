import React, { useState } from 'react'
import { Alert, StyleSheet, View, TextInput, Button, Text, ActivityIndicator } from 'react-native'
import { supabase } from '../../../lib/supabase'

export default function Auth() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function signInWithEmail() {
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password,
    })

    if (error) Alert.alert(error.message)
    setLoading(false)
  }

  async function signUpWithEmail() {
    setLoading(true)
    const {
      data: { session },
      error,
    } = await supabase.auth.signUp({
      email: email,
      password: password,
    })

    if (error) Alert.alert(error.message)
    if (!session && !error) Alert.alert('Please check your inbox for email verification!')
    setLoading(false)
  }

  return (
    <View style={styles.container}>
      <View style={styles.verticallySpaced}>
        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          onChangeText={(text) => setEmail(text)}
          value={email}
          placeholder="email@address.com"
          autoCapitalize={'none'}
          keyboardType="email-address"
        />
      </View>
      <View style={styles.verticallySpaced}>
        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          onChangeText={(text) => setPassword(text)}
          value={password}
          secureTextEntry={true}
          placeholder="Password"
          autoCapitalize={'none'}
        />
      </View>
      
      {loading ? (
        <ActivityIndicator size="large" color="#0000ff" style={styles.mt20} />
      ) : (
        <>
          <View style={[styles.verticallySpaced, styles.mt20]}>
            <Button title="Sign in" onPress={() => signInWithEmail()} />
          </View>
          <View style={styles.verticallySpaced}>
            <Button title="Sign up" onPress={() => signUpWithEmail()} />
          </View>
        </>
      )}
    </View>
  )
}
